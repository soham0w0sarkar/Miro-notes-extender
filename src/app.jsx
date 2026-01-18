import * as React from "react";
import { createRoot } from "react-dom/client";

import "../src/assets/style.css";
import { RichTextEditor } from "./RichTextEditor.jsx";
import {
  APP_ID,
  METADATA_KEY,
  SCHEMA_VERSION,
  MAX_PAYLOAD_SIZE,
  AUTOSAVE_DEBOUNCE_MS,
  SELECTION_DEBOUNCE_MS,
  ENABLE_LOGGING,
} from "./config.js";

// Metadata schema
const createMetadata = (content, authorId) => ({
  schemaVersion: SCHEMA_VERSION,
  content: content || "",
  updatedAt: Date.now(),
  authorId: authorId || null,
});

// Validate metadata structure
const validateMetadata = (metadata) => {
  if (!metadata || typeof metadata !== "object") {
    return false;
  }
  return (
    typeof metadata.content === "string" &&
    typeof metadata.updatedAt === "number" &&
    metadata.schemaVersion === SCHEMA_VERSION
  );
};

// Check if payload size is within limits
const checkPayloadSize = (metadata) => {
  const jsonString = JSON.stringify(metadata);
  const sizeInBytes = new Blob([jsonString]).size;
  return {
    isValid: sizeInBytes <= MAX_PAYLOAD_SIZE,
    size: sizeInBytes,
    maxSize: MAX_PAYLOAD_SIZE,
  };
};

// Analytics logging (internal)
const logEvent = (eventType, data = {}) => {
  if (ENABLE_LOGGING) {
    console.log(`[Annotate] ${eventType}`, data);
  }
};

// Initialize app and get user info
async function initApp() {
  try {
    const currentUserInfo = await miro.board.getUserInfo();
    const currentUserId = currentUserInfo.id;
    return { currentUserId };
  } catch (error) {
    console.error("[Annotate] Error getting user info:", error);
    return { currentUserId: null };
  }
}

// Check if user is editor (creator) of the item
async function checkIsEditor(item) {
  if (!item) {
    return false;
  }

  try {
    const currentUserInfo = await miro.board.getUserInfo();
    const currentUserId = currentUserInfo.id;
    const createdBy = item.createdBy;
    return currentUserId && createdBy === currentUserId;
  } catch (error) {
    console.error("[Annotate] Error checking editor status:", error);
    return false;
  }
}

// Debounce utility
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

const App = () => {
  // Core state
  const [selectedItem, setSelectedItem] = React.useState(null);
  const [selectedItemId, setSelectedItemId] = React.useState(null);
  const [content, setContent] = React.useState("");
  const [isEditor, setIsEditor] = React.useState(false);
  const [currentUserId, setCurrentUserId] = React.useState(null);
  const [selectionCount, setSelectionCount] = React.useState(0);

  // Loading/Saving state
  const [isLoading, setIsLoading] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [lastSavedAt, setLastSavedAt] = React.useState(null);

  // Error state
  const [error, setError] = React.useState(null);
  const [errorType, setErrorType] = React.useState(null); // 'read' | 'write' | 'payload' | 'sdk'

  // Metadata cache (per item ID)
  const metadataCacheRef = React.useRef(new Map());

  // Track the item we're currently editing (to prevent overwrite on selection change)
  const editingItemIdRef = React.useRef(null);

  // Initialize app
  React.useEffect(() => {
    initApp().then(({ currentUserId: userId }) => {
      setCurrentUserId(userId);
    });
  }, []);

  // Load metadata for an item
  const loadMetadata = React.useCallback(async (item) => {
    if (!item) {
      setContent("");
      editingItemIdRef.current = null;
      return;
    }

    const itemId = item.id;
    editingItemIdRef.current = itemId;

    // Check cache first
    if (metadataCacheRef.current.has(itemId)) {
      const cached = metadataCacheRef.current.get(itemId);
      setContent(cached.content || "");
      setLastSavedAt(cached.updatedAt);
      logEvent("annotation_viewed", { itemId, fromCache: true });
      return;
    }

    setIsLoading(true);
    setError(null);
    setErrorType(null);

    try {
      const rawMetadata = await item.getMetadata(APP_ID);
      const annotateData =
        rawMetadata?.[METADATA_KEY] || rawMetadata?.annotate || null;

      // Validate metadata structure
      if (annotateData && validateMetadata(annotateData)) {
        setContent(annotateData.content || "");
        setLastSavedAt(annotateData.updatedAt || null);

        // Cache it
        metadataCacheRef.current.set(itemId, {
          content: annotateData.content || "",
          updatedAt: annotateData.updatedAt || null,
        });

        logEvent("annotation_viewed", { itemId, fromCache: false });
      } else if (annotateData) {
        // Handle corrupt/invalid metadata
        console.warn(
          "[Annotate] Invalid metadata structure, resetting",
          annotateData
        );
        setContent("");
        setLastSavedAt(null);
        setErrorType("read");
        setError("Invalid annotation data format. Starting fresh.");
      } else {
        // No metadata exists
        setContent("");
        setLastSavedAt(null);
        logEvent("annotation_viewed", { itemId, empty: true });
      }
    } catch (error) {
      console.error("[Annotate] Error loading metadata:", error);
      setError("Failed to load annotation");
      setErrorType("read");
      setContent("");
      setLastSavedAt(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Save metadata with validation and error handling
  const saveMetadata = React.useCallback(
    async (item, contentToSave) => {
      if (!item || !isEditor) {
        console.warn("[Annotate] Cannot save: no item or not editor");
        return;
      }

      // Prevent overwrite if selection changed
      if (editingItemIdRef.current !== item.id) {
        console.warn(
          "[Annotate] Prevented overwrite: selection changed during edit"
        );
        return;
      }

      setIsSaving(true);
      setError(null);
      setErrorType(null);

      try {
        const trimmedContent = (contentToSave || "").trim();
        const metadata = createMetadata(trimmedContent, currentUserId);

        // Check payload size
        const sizeCheck = checkPayloadSize(metadata);
        if (!sizeCheck.isValid) {
          setError(
            `Annotation too large (${Math.round(
              sizeCheck.size / 1024
            )}KB / ${Math.round(
              sizeCheck.maxSize / 1024
            )}KB). Please reduce content.`
          );
          setErrorType("payload");
          setIsSaving(false);
          return;
        }

        // Get existing metadata to preserve other keys
        let existingMetadata = {};
        try {
          existingMetadata = (await item.getMetadata(APP_ID)) || {};
        } catch (error) {
          // If metadata doesn't exist, start fresh
          existingMetadata = {};
        }

        // Update with new annotate data
        const updatedMetadata = {
          ...existingMetadata,
          [METADATA_KEY]: metadata,
        };

        await item.setMetadata(APP_ID, updatedMetadata);

        // Update cache
        metadataCacheRef.current.set(item.id, {
          content: trimmedContent,
          updatedAt: metadata.updatedAt,
        });

        setLastSavedAt(metadata.updatedAt);
        const isUpdate = metadataCacheRef.current.has(item.id);
        logEvent(isUpdate ? "annotation_updated" : "annotation_created", {
          itemId: item.id,
          size: sizeCheck.size,
        });
      } catch (error) {
        console.error("[Annotate] Error saving metadata:", error);
        setError(
          `Failed to save annotation: ${error.message || "Unknown error"}`
        );
        setErrorType("write");
        miro.board.notifications.showError("Failed to save annotation");
      } finally {
        setIsSaving(false);
      }
    },
    [isEditor, currentUserId]
  );

  // Debounced autosave
  const debouncedSave = React.useMemo(
    () =>
      debounce(
        (item, content) => saveMetadata(item, content),
        AUTOSAVE_DEBOUNCE_MS
      ),
    [saveMetadata]
  );

  // Handle content changes with autosave
  const handleContentChange = React.useCallback(
    (html) => {
      setContent(html);
      if (isEditor && selectedItem) {
        debouncedSave(selectedItem, html);
      }
    },
    [isEditor, selectedItem, debouncedSave]
  );

  // Handle selection updates with debouncing
  const handleSelectionUpdate = React.useCallback(
    debounce(async (event) => {
      const selectedItems = event.items || [];
      setSelectionCount(selectedItems.length);

      if (selectedItems.length === 0) {
        setSelectedItem(null);
        setSelectedItemId(null);
        setContent("");
        setIsEditor(false);
        editingItemIdRef.current = null;
      } else if (selectedItems.length === 1) {
        const item = selectedItems[0];
        const itemId = item.id;

        setSelectedItem(item);
        setSelectedItemId(itemId);

        const willBeEditor = await checkIsEditor(item);
        setIsEditor(willBeEditor);

        await loadMetadata(item);
      } else {
        // Multi-selection: disable
        setSelectedItem(null);
        setSelectedItemId(null);
        setContent("");
        setIsEditor(false);
        editingItemIdRef.current = null;
      }
    }, SELECTION_DEBOUNCE_MS),
    [loadMetadata]
  );

  // Set up selection listener
  React.useEffect(() => {
    miro.board.ui.on("selection:update", handleSelectionUpdate);

    // Load initial selection
    miro.board
      .getSelection()
      .then((items) => {
        handleSelectionUpdate({ items });
      })
      .catch((error) => {
        console.error("[Annotate] Error getting initial selection:", error);
      });

    return () => {
      // Cleanup handled by debounce
    };
  }, [handleSelectionUpdate]);

  // Render content based on state
  const renderContent = () => {
    if (selectionCount === 0) {
      return (
        <div
          className="cs1 ce12"
          style={{ textAlign: "center", padding: "40px 20px" }}
        >
          <p style={{ fontSize: "16px", color: "#6B7280" }}>
            Select an item to view or create an annotation
          </p>
        </div>
      );
    }

    if (selectionCount > 1) {
      return (
        <div
          className="cs1 ce12"
          style={{ textAlign: "center", padding: "40px 20px" }}
        >
          <p style={{ fontSize: "16px", color: "#6B7280" }}>
            Select a single item to annotate
          </p>
        </div>
      );
    }

    // Error display
    if (error) {
      return (
        <div
          className="cs1 ce12"
          style={{
            padding: "16px",
            margin: "16px",
            backgroundColor: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: "4px",
            color: "#991B1B",
            fontSize: "14px",
          }}
        >
          <strong>Error:</strong> {error}
        </div>
      );
    }

    return (
      <div className="cs1 ce12" style={{ padding: "20px" }}>
        <div style={{ marginBottom: "16px" }}>
          <label
            htmlFor="annotation-editor"
            style={{
              display: "block",
              marginBottom: "8px",
              fontWeight: "600",
              fontSize: "14px",
            }}
          >
            Annotation
          </label>
          {isLoading ? (
            <div
              style={{ padding: "20px", textAlign: "center", color: "#6B7280" }}
            >
              Loading...
            </div>
          ) : (
            <RichTextEditor
              value={content}
              onChange={handleContentChange}
              disabled={!isEditor}
              placeholder="Add an annotation..."
            />
          )}
        </div>

        {isEditor && (
          <div style={{ fontSize: "12px", color: "#6B7280", marginTop: "8px" }}>
            {isSaving ? (
              <span>Auto-saving...</span>
            ) : lastSavedAt ? (
              <span>Saved {new Date(lastSavedAt).toLocaleTimeString()}</span>
            ) : (
              <span>Start typing to save automatically</span>
            )}
          </div>
        )}

        {!isEditor && (
          <div style={{ fontSize: "12px", color: "#6B7280", marginTop: "8px" }}>
            Read-only mode (Viewer)
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="grid wrapper">
      <div className="cs1 ce12">
        <h1
          style={{ fontSize: "20px", marginBottom: "20px", fontWeight: "600" }}
        >
          Annotate
        </h1>
      </div>
      {renderContent()}
    </div>
  );
};

const container = document.getElementById("root");
const root = createRoot(container);
root.render(<App />);
