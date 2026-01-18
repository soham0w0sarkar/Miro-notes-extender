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
import {
  createSection,
  createNote,
  createMetadataStructure,
  getDefaultSection,
  sortSections,
  sortNotes,
} from "./models.js";

// Analytics logging
const logEvent = (eventType, data = {}) => {
  if (ENABLE_LOGGING) {
    console.log(`[Annotate] ${eventType}`, data);
  }
};

// Check payload size
const checkPayloadSize = (metadata) => {
  const jsonString = JSON.stringify(metadata);
  const sizeInBytes = new Blob([jsonString]).size;
  return {
    isValid: sizeInBytes <= MAX_PAYLOAD_SIZE,
    size: sizeInBytes,
    maxSize: MAX_PAYLOAD_SIZE,
  };
};

// Initialize app
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

// Check if user is editor
async function checkIsEditor(item) {
  if (!item) return false;
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
  const [sections, setSections] = React.useState([]);
  const [activeNoteId, setActiveNoteId] = React.useState(null);
  const [activeSectionId, setActiveSectionId] = React.useState(null);
  const [expandedSections, setExpandedSections] = React.useState(new Set());
  const [isEditor, setIsEditor] = React.useState(false);
  const [currentUserId, setCurrentUserId] = React.useState(null);
  const [selectionCount, setSelectionCount] = React.useState(0);

  // Editing state
  const [editingNoteHeading, setEditingNoteHeading] = React.useState("");
  const [editingNoteBody, setEditingNoteBody] = React.useState("");
  const [editingNoteId, setEditingNoteId] = React.useState(null);
  const [isDirty, setIsDirty] = React.useState(false);

  // UI state
  const [isLoading, setIsLoading] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [currentView, setCurrentView] = React.useState("list"); // "list" or "editor"

  // Section editing state
  const [editingSectionId, setEditingSectionId] = React.useState(null);
  const [editingSectionName, setEditingSectionName] = React.useState("");

  // Cache
  const metadataCacheRef = React.useRef(new Map());
  const editingItemIdRef = React.useRef(null);

  // Initialize app
  React.useEffect(() => {
    initApp().then(({ currentUserId: userId }) => {
      setCurrentUserId(userId);
    });
  }, []);

  // Load metadata from board item
  const loadMetadata = React.useCallback(
    async (item) => {
      if (!item) {
        setSections([]);
        setActiveNoteId(null);
        setActiveSectionId(null);
        editingItemIdRef.current = null;
        return;
      }

      const itemId = item.id;
      editingItemIdRef.current = itemId;

      // Check cache
      if (metadataCacheRef.current.has(itemId)) {
        const cached = metadataCacheRef.current.get(itemId);
        setSections(cached.sections || []);
        if (cached.sections && cached.sections.length > 0) {
          setExpandedSections(new Set([cached.sections[0].id])); // Expand first section
        }
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const rawMetadata = await item.getMetadata(APP_ID);
        const annotateData =
          rawMetadata?.[METADATA_KEY] || rawMetadata?.annotate || null;

        if (annotateData && annotateData.sections) {
          const loadedSections = sortSections(annotateData.sections);
          // Sort notes within each section
          loadedSections.forEach((section) => {
            section.notes = sortNotes(section.notes || []);
          });
          setSections(loadedSections);

          // Expand first section by default
          if (loadedSections.length > 0) {
            setExpandedSections(new Set([loadedSections[0].id]));
          }

          // Cache it
          metadataCacheRef.current.set(itemId, { sections: loadedSections });
          logEvent("metadata_loaded", {
            itemId,
            sectionsCount: loadedSections.length,
          });
        } else {
          // First install - create default structure
          const defaultMetadata = createMetadataStructure(currentUserId);
          setSections(defaultMetadata.sections);
          setExpandedSections(new Set([defaultMetadata.sections[0].id]));
          metadataCacheRef.current.set(itemId, {
            sections: defaultMetadata.sections,
          });
        }
      } catch (error) {
        console.error("[Annotate] Error loading metadata:", error);
        setError("Failed to load annotations");
      } finally {
        setIsLoading(false);
      }
    },
    [currentUserId]
  );

  // Save metadata to board item
  const saveMetadata = React.useCallback(
    async (item, sectionsToSave) => {
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

      try {
        const metadata = {
          schemaVersion: SCHEMA_VERSION,
          sections: sectionsToSave || sections,
          updatedAt: Date.now(),
          authorId: currentUserId,
        };

        // Check payload size
        const sizeCheck = checkPayloadSize(metadata);
        if (!sizeCheck.isValid) {
          setError(
            `Data too large (${Math.round(
              sizeCheck.size / 1024
            )}KB / ${Math.round(
              sizeCheck.maxSize / 1024
            )}KB). Please reduce content.`
          );
          setIsSaving(false);
          return;
        }

        // Get existing metadata to preserve other keys
        let existingMetadata = {};
        try {
          existingMetadata = (await item.getMetadata(APP_ID)) || {};
        } catch (error) {
          existingMetadata = {};
        }

        const updatedMetadata = {
          ...existingMetadata,
          [METADATA_KEY]: metadata,
        };

        await item.setMetadata(APP_ID, updatedMetadata);

        // Update cache
        metadataCacheRef.current.set(item.id, {
          sections: sectionsToSave || sections,
        });
        setIsDirty(false);
        logEvent("metadata_saved", {
          itemId: item.id,
          sectionsCount: (sectionsToSave || sections).length,
        });
      } catch (error) {
        console.error("[Annotate] Error saving metadata:", error);
        setError(`Failed to save: ${error.message || "Unknown error"}`);
        miro.board.notifications.showError("Failed to save annotations");
      } finally {
        setIsSaving(false);
      }
    },
    [isEditor, currentUserId, sections]
  );

  // Debounced autosave
  const debouncedSave = React.useMemo(
    () =>
      debounce(
        (item, sectionsToSave) => saveMetadata(item, sectionsToSave),
        AUTOSAVE_DEBOUNCE_MS
      ),
    [saveMetadata]
  );

  // Handle selection updates
  const handleSelectionUpdate = React.useCallback(
    debounce(async (event) => {
      const selectedItems = event.items || [];
      setSelectionCount(selectedItems.length);

      if (selectedItems.length === 0) {
        setSelectedItem(null);
        setSelectedItemId(null);
        setActiveNoteId(null);
        setActiveSectionId(null);
        setEditingNoteId(null);
        setIsDirty(false);
        setCurrentView("list"); // Return to list view
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
        setActiveNoteId(null);
        setActiveSectionId(null);
        setEditingNoteId(null);
        setIsDirty(false);
        setCurrentView("list"); // Return to list view
      }
    }, SELECTION_DEBOUNCE_MS),
    [loadMetadata]
  );

  // Set up selection listener
  React.useEffect(() => {
    miro.board.ui.on("selection:update", handleSelectionUpdate);

    miro.board
      .getSelection()
      .then((items) => {
        handleSelectionUpdate({ items });
      })
      .catch((error) => {
        console.error("[Annotate] Error getting initial selection:", error);
      });
  }, [handleSelectionUpdate]);

  // Section management
  const addSection = React.useCallback(() => {
    if (!isEditor || !selectedItem) return;

    const newSection = createSection("New Section", sections.length);
    const updatedSections = [newSection, ...sections];
    setSections(updatedSections);
    setExpandedSections((prev) => new Set([...prev, newSection.id]));
    setIsDirty(true);
    debouncedSave(selectedItem, updatedSections);
    logEvent("section_added", { sectionId: newSection.id });
  }, [isEditor, selectedItem, sections, debouncedSave]);

  const renameSection = React.useCallback(
    (sectionId, newName) => {
      if (!isEditor || !newName.trim()) return;

      const updatedSections = sections.map((section) =>
        section.id === sectionId
          ? { ...section, name: newName.trim(), updatedAt: Date.now() }
          : section
      );
      setSections(updatedSections);
      setEditingSectionId(null);
      setEditingSectionName("");
      setIsDirty(true);
      if (selectedItem) {
        debouncedSave(selectedItem, updatedSections);
      }
      logEvent("section_renamed", { sectionId, newName });
    },
    [isEditor, sections, selectedItem, debouncedSave]
  );

  const deleteSection = React.useCallback(
    (sectionId) => {
      if (!isEditor || !selectedItem) return;

      const section = sections.find((s) => s.id === sectionId);
      if (!section) return;

      // Confirmation
      if (
        !window.confirm(
          `Delete "${section.name}" and all ${
            section.notes?.length || 0
          } notes inside?`
        )
      ) {
        return;
      }

      const updatedSections = sections.filter((s) => s.id !== sectionId);
      // Reorder remaining sections
      updatedSections.forEach((s, index) => {
        s.order = index;
      });

      setSections(updatedSections);
      if (activeSectionId === sectionId) {
        setActiveSectionId(null);
        setActiveNoteId(null);
        setEditingNoteId(null);
      }
      setIsDirty(true);
      debouncedSave(selectedItem, updatedSections);
      logEvent("section_deleted", {
        sectionId,
        notesCount: section.notes?.length || 0,
      });
    },
    [isEditor, selectedItem, sections, activeSectionId, debouncedSave]
  );

  const moveSection = React.useCallback(
    (sectionId, direction) => {
      if (!isEditor || !selectedItem) return;

      const index = sections.findIndex((s) => s.id === sectionId);
      if (index === -1) return;

      const newIndex = direction === "up" ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= sections.length) return;

      const updatedSections = [...sections];
      [updatedSections[index], updatedSections[newIndex]] = [
        updatedSections[newIndex],
        updatedSections[index],
      ];
      // Update orders
      updatedSections.forEach((s, i) => {
        s.order = i;
      });

      setSections(updatedSections);
      setIsDirty(true);
      debouncedSave(selectedItem, updatedSections);
      logEvent("section_moved", { sectionId, direction });
    },
    [isEditor, selectedItem, sections, debouncedSave]
  );

  // Note management - createNoteInSection must be defined first
  const createNoteInSection = React.useCallback(
    (sectionId) => {
      if (!isEditor || !selectedItem) return;

      const section = sections.find((s) => s.id === sectionId);
      if (!section) return;

      const itemName = selectedItem.plainText || selectedItem.content || "";
      const itemType = selectedItem.type || "item";
      const notesCount = section.notes?.length || 0;
      const newNote = createNote(
        selectedItem.id,
        itemName,
        itemType,
        sectionId,
        "", // heading - will use item name if empty
        "", // body
        currentUserId,
        notesCount
      );

      const updatedSections = sections.map((s) =>
        s.id === sectionId ? { ...s, notes: [...(s.notes || []), newNote] } : s
      );

      setSections(updatedSections);
      setActiveSectionId(sectionId);
      setActiveNoteId(newNote.id);
      setEditingNoteId(newNote.id);
      setEditingNoteHeading(newNote.heading);
      setEditingNoteBody("");
      setExpandedSections((prev) => new Set([...prev, sectionId]));
      setCurrentView("editor"); // Navigate to editor page
      setIsDirty(true);
      debouncedSave(selectedItem, updatedSections);
      logEvent("note_created", { noteId: newNote.id, sectionId });
    },
    [isEditor, selectedItem, sections, currentUserId, debouncedSave]
  );

  const createNewNote = React.useCallback(() => {
    if (!isEditor || !selectedItem) return;

    const defaultSection = getDefaultSection(sections);
    const sectionId = defaultSection?.id || sections[0]?.id;
    if (!sectionId) {
      // No sections - create General
      const generalSection = createSection("General", 0);
      const updatedSections = [generalSection];
      setSections(updatedSections);
      setExpandedSections(new Set([generalSection.id]));
      createNoteInSection(generalSection.id);
      return;
    }

    createNoteInSection(sectionId);
  }, [isEditor, selectedItem, sections, createNoteInSection]);

  const selectNote = React.useCallback(
    (noteId, sectionId) => {
      const section = sections.find((s) => s.id === sectionId);
      const note = section?.notes?.find((n) => n.id === noteId);
      if (!note) return;

      setActiveNoteId(noteId);
      setActiveSectionId(sectionId);
      setEditingNoteId(noteId);
      setEditingNoteHeading(note.heading || "");
      setEditingNoteBody(note.body || "");
      setExpandedSections((prev) => new Set([...prev, sectionId]));
      setCurrentView("editor"); // Navigate to editor page
    },
    [sections]
  );

  const goBackToList = React.useCallback(() => {
    setCurrentView("list");
    // Optionally clear active note selection
    // setActiveNoteId(null);
    // setEditingNoteId(null);
  }, []);

  const updateNote = React.useCallback(
    (noteId, updates) => {
      if (!isEditor || !selectedItem) return;

      const updatedSections = sections.map((section) => ({
        ...section,
        notes:
          section.notes?.map((note) =>
            note.id === noteId
              ? { ...note, ...updates, updatedAt: Date.now() }
              : note
          ) || [],
      }));

      setSections(updatedSections);
      setIsDirty(true);
      debouncedSave(selectedItem, updatedSections);
    },
    [isEditor, selectedItem, sections, debouncedSave]
  );

  const deleteNote = React.useCallback(
    (noteId, sectionId) => {
      if (!isEditor || !selectedItem) return;

      // Warning
      if (!window.confirm("Delete this note?")) {
        return;
      }

      const updatedSections = sections.map((section) => {
        if (section.id !== sectionId) return section;

        const noteIndex =
          section.notes?.findIndex((n) => n.id === noteId) ?? -1;
        if (noteIndex === -1) return section;

        const updatedNotes = section.notes.filter((n) => n.id !== noteId);
        // Reorder remaining notes
        updatedNotes.forEach((n, index) => {
          n.order = index;
        });

        return { ...section, notes: updatedNotes };
      });

      setSections(updatedSections);
      if (activeNoteId === noteId) {
        setActiveNoteId(null);
        setEditingNoteId(null);
        setEditingNoteHeading("");
        setEditingNoteBody("");
      }
      setIsDirty(true);
      debouncedSave(selectedItem, updatedSections);
      logEvent("note_deleted", { noteId, sectionId });
    },
    [isEditor, selectedItem, sections, activeNoteId, debouncedSave]
  );

  const moveNote = React.useCallback(
    (noteId, sectionId, direction) => {
      if (!isEditor || !selectedItem) return;

      const section = sections.find((s) => s.id === sectionId);
      if (!section || !section.notes) return;

      const noteIndex = section.notes.findIndex((n) => n.id === noteId);
      if (noteIndex === -1) return;

      const newIndex = direction === "up" ? noteIndex - 1 : noteIndex + 1;
      if (newIndex < 0 || newIndex >= section.notes.length) return;

      const updatedSections = sections.map((s) => {
        if (s.id !== sectionId) return s;

        const updatedNotes = [...s.notes];
        [updatedNotes[noteIndex], updatedNotes[newIndex]] = [
          updatedNotes[newIndex],
          updatedNotes[noteIndex],
        ];
        updatedNotes.forEach((n, i) => {
          n.order = i;
        });

        return { ...s, notes: updatedNotes };
      });

      setSections(updatedSections);
      setIsDirty(true);
      debouncedSave(selectedItem, updatedSections);
      logEvent("note_moved", { noteId, sectionId, direction });
    },
    [isEditor, selectedItem, sections, debouncedSave]
  );

  const moveNoteToSection = React.useCallback(
    (noteId, fromSectionId, toSectionId) => {
      if (!isEditor || !selectedItem) return;

      const fromSection = sections.find((s) => s.id === fromSectionId);
      const note = fromSection?.notes?.find((n) => n.id === noteId);
      if (!note) return;

      const toSection = sections.find((s) => s.id === toSectionId);
      if (!toSection) return;

      const updatedSections = sections.map((section) => {
        if (section.id === fromSectionId) {
          // Remove from source section
          const updatedNotes =
            section.notes?.filter((n) => n.id !== noteId) || [];
          updatedNotes.forEach((n, index) => {
            n.order = index;
          });
          return { ...section, notes: updatedNotes };
        }
        if (section.id === toSectionId) {
          // Add to target section
          const notesCount = section.notes?.length || 0;
          const updatedNote = {
            ...note,
            sectionId: toSectionId,
            order: notesCount,
            updatedAt: Date.now(),
          };
          return { ...section, notes: [...(section.notes || []), updatedNote] };
        }
        return section;
      });

      setSections(updatedSections);
      setActiveSectionId(toSectionId);
      setIsDirty(true);
      debouncedSave(selectedItem, updatedSections);
      logEvent("note_moved_to_section", { noteId, fromSectionId, toSectionId });
    },
    [isEditor, selectedItem, sections, debouncedSave]
  );

  // Handle note field changes
  const handleNoteHeadingChange = React.useCallback(
    (value) => {
      setEditingNoteHeading(value);
      if (editingNoteId) {
        setIsDirty(true);
        updateNote(editingNoteId, { heading: value });
      }
    },
    [editingNoteId, updateNote]
  );

  const handleNoteBodyChange = React.useCallback(
    (value) => {
      setEditingNoteBody(value);
      if (editingNoteId) {
        setIsDirty(true);
        updateNote(editingNoteId, { body: value });
      }
    },
    [editingNoteId, updateNote]
  );

  // Toggle section expand/collapse
  const toggleSection = React.useCallback((sectionId) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  }, []);

  // Render sections and notes list
  const renderSectionsList = () => {
    if (sections.length === 0) {
      return (
        <div style={{ padding: "20px", textAlign: "center", color: "#6B7280" }}>
          No sections yet. {isEditor && "Add a section to get started."}
        </div>
      );
    }

    return sections.map((section) => {
      const isExpanded = expandedSections.has(section.id);
      const notes = sortNotes(section.notes || []);
      const isEditing = editingSectionId === section.id;

      return (
        <div
          key={section.id}
          style={{
            marginBottom: "12px",
            border: "1px solid #E5E7EB",
            borderRadius: "8px",
            backgroundColor: "#FFFFFF",
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
            transition: "all 0.2s ease",
            overflow: "hidden",
          }}
        >
          {/* Section header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "12px 16px",
              backgroundColor: "#FAFBFC",
              cursor: "pointer",
              transition: "background-color 0.2s ease",
              borderBottom: isExpanded ? "1px solid #E5E7EB" : "none",
            }}
            onClick={() => toggleSection(section.id)}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#F3F4F6";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "#FAFBFC";
            }}
          >
            <span
              style={{
                marginRight: "10px",
                fontSize: "10px",
                color: "#6B7280",
                transition: "transform 0.2s ease",
                transform: isExpanded ? "rotate(0deg)" : "rotate(-90deg)",
              }}
            >
              ▼
            </span>
            {isEditing ? (
              <input
                type="text"
                value={editingSectionName}
                onChange={(e) => setEditingSectionName(e.target.value)}
                onBlur={() => renameSection(section.id, editingSectionName)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    renameSection(section.id, editingSectionName);
                  } else if (e.key === "Escape") {
                    setEditingSectionId(null);
                    setEditingSectionName("");
                  }
                }}
                autoFocus
                style={{ flex: 1, padding: "4px", fontSize: "14px" }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <span
                  style={{
                    flex: 1,
                    fontWeight: "600",
                    fontSize: "15px",
                    color: "#111827",
                    letterSpacing: "-0.01em",
                  }}
                  onDoubleClick={() => {
                    if (isEditor) {
                      setEditingSectionId(section.id);
                      setEditingSectionName(section.name);
                    }
                  }}
                >
                  {section.name}
                </span>
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: "500",
                    color: "#6B7280",
                    marginRight: "12px",
                    backgroundColor: "#E5E7EB",
                    padding: "2px 8px",
                    borderRadius: "12px",
                  }}
                >
                  {notes.length}
                </span>
              </>
            )}
            {isEditor && !isEditing && (
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    moveSection(section.id, "up");
                  }}
                  disabled={
                    sections.findIndex((s) => s.id === section.id) === 0
                  }
                  style={{
                    padding: "6px 10px",
                    fontSize: "12px",
                    fontWeight: "500",
                    border: "1px solid #D1D5DB",
                    borderRadius: "6px",
                    cursor: "pointer",
                    backgroundColor: "#FFFFFF",
                    color: "#374151",
                    transition: "all 0.2s ease",
                    opacity:
                      sections.findIndex((s) => s.id === section.id) === 0
                        ? 0.4
                        : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (sections.findIndex((s) => s.id === section.id) !== 0) {
                      e.currentTarget.style.backgroundColor = "#F3F4F6";
                      e.currentTarget.style.borderColor = "#9CA3AF";
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "#FFFFFF";
                    e.currentTarget.style.borderColor = "#D1D5DB";
                  }}
                >
                  ↑
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    moveSection(section.id, "down");
                  }}
                  disabled={
                    sections.findIndex((s) => s.id === section.id) ===
                    sections.length - 1
                  }
                  style={{
                    padding: "6px 10px",
                    fontSize: "12px",
                    fontWeight: "500",
                    border: "1px solid #D1D5DB",
                    borderRadius: "6px",
                    cursor: "pointer",
                    backgroundColor: "#FFFFFF",
                    color: "#374151",
                    transition: "all 0.2s ease",
                    opacity:
                      sections.findIndex((s) => s.id === section.id) ===
                      sections.length - 1
                        ? 0.4
                        : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (
                      sections.findIndex((s) => s.id === section.id) !==
                      sections.length - 1
                    ) {
                      e.currentTarget.style.backgroundColor = "#F3F4F6";
                      e.currentTarget.style.borderColor = "#9CA3AF";
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "#FFFFFF";
                    e.currentTarget.style.borderColor = "#D1D5DB";
                  }}
                >
                  ↓
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSection(section.id);
                  }}
                  style={{
                    padding: "6px 12px",
                    fontSize: "12px",
                    fontWeight: "500",
                    border: "1px solid #FCA5A5",
                    borderRadius: "6px",
                    cursor: "pointer",
                    backgroundColor: "#FFFFFF",
                    color: "#DC2626",
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "#FEE2E2";
                    e.currentTarget.style.borderColor = "#DC2626";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "#FFFFFF";
                    e.currentTarget.style.borderColor = "#FCA5A5";
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>

          {/* Section notes */}
          {isExpanded && (
            <div style={{ padding: "12px" }}>
              {notes.length === 0 ? (
                <div
                  style={{
                    padding: "24px 12px",
                    fontSize: "13px",
                    color: "#9CA3AF",
                    textAlign: "center",
                    fontStyle: "italic",
                  }}
                >
                  No notes in this section
                </div>
              ) : (
                notes.map((note) => {
                  const isActive = activeNoteId === note.id;
                  return (
                    <div
                      key={note.id}
                      onClick={() => selectNote(note.id, section.id)}
                      style={{
                        padding: "12px",
                        marginBottom: "8px",
                        backgroundColor: isActive ? "#EFF6FF" : "#FAFBFC",
                        border: isActive
                          ? "2px solid #3B82F6"
                          : "1px solid #E5E7EB",
                        borderRadius: "6px",
                        cursor: "pointer",
                        transition: "all 0.2s ease",
                        boxShadow: isActive
                          ? "0 2px 4px rgba(59, 130, 246, 0.15)"
                          : "0 1px 2px rgba(0,0,0,0.04)",
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.backgroundColor = "#F3F4F6";
                          e.currentTarget.style.borderColor = "#D1D5DB";
                          e.currentTarget.style.boxShadow =
                            "0 2px 4px rgba(0,0,0,0.08)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.backgroundColor = "#FAFBFC";
                          e.currentTarget.style.borderColor = "#E5E7EB";
                          e.currentTarget.style.boxShadow =
                            "0 1px 2px rgba(0,0,0,0.04)";
                        }
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "start",
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div
                            style={{
                              fontWeight: "600",
                              fontSize: "14px",
                              marginBottom: "6px",
                              color: "#111827",
                              lineHeight: "1.4",
                            }}
                          >
                            {note.heading || "Untitled"}
                          </div>
                          <div
                            style={{
                              fontSize: "13px",
                              color: "#6B7280",
                              lineHeight: "1.5",
                              marginBottom: "6px",
                            }}
                          >
                            {note.body
                              ? note.body.replace(/<[^>]*>/g, "").length > 60
                                ? note.body
                                    .replace(/<[^>]*>/g, "")
                                    .substring(0, 60) + "..."
                                : note.body.replace(/<[^>]*>/g, "")
                              : "No content"}
                          </div>
                          <div
                            style={{
                              fontSize: "11px",
                              color: "#9CA3AF",
                              marginTop: "6px",
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                            }}
                          >
                            <span
                              style={{
                                backgroundColor: "#F3F4F6",
                                padding: "2px 6px",
                                borderRadius: "4px",
                              }}
                            >
                              {note.itemName}
                            </span>
                          </div>
                        </div>
                        {isEditor && (
                          <div
                            style={{
                              display: "flex",
                              gap: "4px",
                              marginLeft: "12px",
                            }}
                          >
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                moveNote(note.id, section.id, "up");
                              }}
                              disabled={
                                notes.findIndex((n) => n.id === note.id) === 0
                              }
                              style={{
                                padding: "4px 8px",
                                fontSize: "12px",
                                border: "1px solid #D1D5DB",
                                borderRadius: "4px",
                                backgroundColor: "#FFFFFF",
                                cursor:
                                  notes.findIndex((n) => n.id === note.id) === 0
                                    ? "not-allowed"
                                    : "pointer",
                                opacity:
                                  notes.findIndex((n) => n.id === note.id) === 0
                                    ? 0.4
                                    : 1,
                                transition: "all 0.2s ease",
                              }}
                              onMouseEnter={(e) => {
                                if (
                                  notes.findIndex((n) => n.id === note.id) !== 0
                                ) {
                                  e.currentTarget.style.backgroundColor =
                                    "#F3F4F6";
                                }
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor =
                                  "#FFFFFF";
                              }}
                            >
                              ↑
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                moveNote(note.id, section.id, "down");
                              }}
                              disabled={
                                notes.findIndex((n) => n.id === note.id) ===
                                notes.length - 1
                              }
                              style={{
                                padding: "4px 8px",
                                fontSize: "12px",
                                border: "1px solid #D1D5DB",
                                borderRadius: "4px",
                                backgroundColor: "#FFFFFF",
                                cursor:
                                  notes.findIndex((n) => n.id === note.id) ===
                                  notes.length - 1
                                    ? "not-allowed"
                                    : "pointer",
                                opacity:
                                  notes.findIndex((n) => n.id === note.id) ===
                                  notes.length - 1
                                    ? 0.4
                                    : 1,
                                transition: "all 0.2s ease",
                              }}
                              onMouseEnter={(e) => {
                                if (
                                  notes.findIndex((n) => n.id === note.id) !==
                                  notes.length - 1
                                ) {
                                  e.currentTarget.style.backgroundColor =
                                    "#F3F4F6";
                                }
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor =
                                  "#FFFFFF";
                              }}
                            >
                              ↓
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteNote(note.id, section.id);
                              }}
                              style={{
                                padding: "4px 8px",
                                fontSize: "14px",
                                border: "1px solid #FCA5A5",
                                borderRadius: "4px",
                                backgroundColor: "#FFFFFF",
                                color: "#DC2626",
                                cursor: "pointer",
                                transition: "all 0.2s ease",
                                fontWeight: "500",
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor =
                                  "#FEE2E2";
                                e.currentTarget.style.borderColor = "#DC2626";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor =
                                  "#FFFFFF";
                                e.currentTarget.style.borderColor = "#FCA5A5";
                              }}
                            >
                              ×
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      );
    });
  };

  // Render note editor page
  const renderNoteEditor = () => {
    if (!activeNoteId || !editingNoteId) {
      return (
        <div
          style={{
            padding: "40px 20px",
            textAlign: "center",
            color: "#6B7280",
          }}
        >
          {selectedItem
            ? "Select or create a note to edit"
            : "Select an item to create notes"}
        </div>
      );
    }

    const activeNote = sections
      .flatMap((s) => s.notes || [])
      .find((n) => n.id === activeNoteId);

    if (!activeNote) return null;

    return (
      <div style={{ padding: "24px", height: "100%", overflowY: "auto" }}>
        {/* Back button */}
        <button
          onClick={goBackToList}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "20px",
            padding: "8px 12px",
            fontSize: "14px",
            fontWeight: "500",
            border: "1px solid #D1D5DB",
            borderRadius: "6px",
            cursor: "pointer",
            backgroundColor: "#FFFFFF",
            color: "#374151",
            transition: "all 0.2s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "#F3F4F6";
            e.currentTarget.style.borderColor = "#9CA3AF";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "#FFFFFF";
            e.currentTarget.style.borderColor = "#D1D5DB";
          }}
        >
          <span style={{ fontSize: "16px" }}>←</span>
          Back to Sections
        </button>
        <div style={{ marginBottom: "16px" }}>
          <label
            style={{
              display: "block",
              marginBottom: "8px",
              fontWeight: "600",
              fontSize: "14px",
            }}
          >
            Heading
          </label>
          <input
            type="text"
            value={editingNoteHeading}
            onChange={(e) => handleNoteHeadingChange(e.target.value)}
            disabled={!isEditor}
            placeholder={activeNote.itemName || "Note heading"}
            style={{
              width: "100%",
              padding: "8px",
              fontSize: "14px",
              border: "1px solid #D1D5DB",
              borderRadius: "4px",
            }}
          />
        </div>

        <div style={{ marginBottom: "20px" }}>
          <label
            style={{
              display: "block",
              marginBottom: "8px",
              fontWeight: "600",
              fontSize: "14px",
              color: "#374151",
            }}
          >
            Body <span style={{ color: "#DC2626" }}>*</span>
          </label>
          <RichTextEditor
            value={editingNoteBody}
            onChange={handleNoteBodyChange}
            disabled={!isEditor}
            placeholder="Note content (required)"
          />
        </div>

        <div
          style={{
            padding: "12px",
            backgroundColor: "#F9FAFB",
            borderRadius: "6px",
            fontSize: "12px",
            color: "#6B7280",
            marginTop: "20px",
            border: "1px solid #E5E7EB",
          }}
        >
          <div style={{ marginBottom: "8px" }}>
            Bound to:{" "}
            <strong style={{ color: "#374151" }}>{activeNote.itemName}</strong>
          </div>
          {isEditor && (
            <button
              onClick={async () => {
                try {
                  // Prompt user to select a new item
                  miro.board.notifications.showInfo(
                    "Select a new board item to bind this note to"
                  );

                  // Wait for selection change
                  const handleSelectionChange = async () => {
                    try {
                      const selection = await miro.board.getSelection();
                      if (selection && selection.length === 1) {
                        const newItem = selection[0];
                        const newItemName =
                          newItem.plainText ||
                          newItem.content ||
                          newItem.type ||
                          "Untitled";
                        const newItemType = newItem.type || "item";

                        // Update note with new item binding
                        updateNote(activeNote.id, {
                          itemId: newItem.id,
                          itemName: newItemName,
                          itemType: newItemType,
                        });

                        miro.board.notifications.showInfo(
                          `Note bound to: ${newItemName}`
                        );

                        // Remove listener after use
                        miro.board.ui.off(
                          "selection:update",
                          handleSelectionChange
                        );
                      }
                    } catch (error) {
                      console.error(
                        "[Annotate] Error changing bound item:",
                        error
                      );
                      miro.board.notifications.showError(
                        "Failed to change bound item"
                      );
                      miro.board.ui.off(
                        "selection:update",
                        handleSelectionChange
                      );
                    }
                  };

                  // Listen for selection change
                  miro.board.ui.on("selection:update", handleSelectionChange);

                  // Auto-remove listener after 30 seconds
                  setTimeout(() => {
                    miro.board.ui.off(
                      "selection:update",
                      handleSelectionChange
                    );
                  }, 30000);
                } catch (error) {
                  console.error(
                    "[Annotate] Error setting up change bound item:",
                    error
                  );
                  miro.board.notifications.showError(
                    "Failed to set up item selection"
                  );
                }
              }}
              style={{
                padding: "6px 14px",
                fontSize: "12px",
                fontWeight: "500",
                border: "1px solid #D1D5DB",
                borderRadius: "6px",
                cursor: "pointer",
                backgroundColor: "#FFFFFF",
                color: "#374151",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "#F3F4F6";
                e.currentTarget.style.borderColor = "#9CA3AF";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "#FFFFFF";
                e.currentTarget.style.borderColor = "#D1D5DB";
              }}
            >
              Change
            </button>
          )}
        </div>

        {isSaving && (
          <div
            style={{
              fontSize: "12px",
              color: "#10B981",
              marginTop: "12px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: "#10B981",
                animation: "pulse 1.5s ease-in-out infinite",
              }}
            />
            Auto-saving...
          </div>
        )}
      </div>
    );
  };

  // Main render
  const renderContent = () => {
    if (selectionCount === 0) {
      return (
        <div
          style={{
            textAlign: "center",
            padding: "40px 20px",
            color: "#6B7280",
          }}
        >
          Select an item to view or create annotations
        </div>
      );
    }

    if (selectionCount > 1) {
      return (
        <div
          style={{
            textAlign: "center",
            padding: "40px 20px",
            color: "#6B7280",
          }}
        >
          Select a single item to annotate
        </div>
      );
    }

    if (isLoading) {
      return (
        <div
          style={{
            textAlign: "center",
            padding: "40px 20px",
            color: "#6B7280",
          }}
        >
          Loading...
        </div>
      );
    }

    // Show editor page or list page based on currentView
    if (currentView === "editor") {
      return (
        <div
          style={{
            height: "100%",
            overflow: "hidden",
            backgroundColor: "#FFFFFF",
          }}
        >
          {renderNoteEditor()}
        </div>
      );
    }

    // Show sections list page
    return (
      <div
        style={{
          height: "100%",
          overflowY: "auto",
          backgroundColor: "#FAFBFC",
        }}
      >
        <div style={{ padding: "20px 24px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "12px",
            }}
          >
            <h2
              style={{
                fontSize: "16px",
                fontWeight: "600",
                color: "#111827",
                margin: 0,
              }}
            >
              Sections
            </h2>
            {isEditor && (
              <button
                onClick={addSection}
                className="button button-primary"
                style={{
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: "500",
                  borderRadius: "6px",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-1px)";
                  e.currentTarget.style.boxShadow = "0 2px 4px rgba(0,0,0,0.1)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow =
                    "0 1px 2px rgba(0,0,0,0.05)";
                }}
              >
                + Add Section
              </button>
            )}
          </div>
          {renderSectionsList()}
          {isEditor && selectedItem && (
            <button
              onClick={createNewNote}
              className="button button-primary"
              style={{
                width: "100%",
                marginTop: "16px",
                padding: "10px 16px",
                fontSize: "14px",
                fontWeight: "500",
                borderRadius: "6px",
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.boxShadow = "0 2px 4px rgba(0,0,0,0.1)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 1px 2px rgba(0,0,0,0.05)";
              }}
            >
              + New Note
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className="grid wrapper"
      style={{ height: "100vh", display: "flex", flexDirection: "column" }}
    >
      <div
        className="cs1 ce12"
        style={{
          padding: "20px 24px",
          borderBottom: "1px solid #E5E7EB",
          backgroundColor: "#FFFFFF",
        }}
      >
        {error && (
          <div style={{ fontSize: "12px", color: "#DC2626", marginTop: "8px" }}>
            {error}
          </div>
        )}
      </div>

      {renderContent()}
    </div>
  );
};

const container = document.getElementById("root");
const root = createRoot(container);
root.render(<App />);
