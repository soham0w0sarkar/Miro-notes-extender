import * as React from "react";

/**
 * Rich Text Editor component with formatting toolbar
 * Similar to Miro's card description editor
 */
export function RichTextEditor({ value, onChange, disabled, placeholder }) {
  const editorRef = React.useRef(null);
  const [isFocused, setIsFocused] = React.useState(false);

  // Update editor content when value changes externally
  React.useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value || "";
    }
  }, [value]);

  // Handle content change
  const handleInput = React.useCallback(() => {
    if (editorRef.current && onChange) {
      onChange(editorRef.current.innerHTML);
    }
  }, [onChange]);

  // Handle paste to strip formatting (optional - can be adjusted)
  const handlePaste = React.useCallback((e) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  }, []);

  // Formatting commands
  const execCommand = React.useCallback(
    (command, value = null) => {
      document.execCommand(command, false, value);
      editorRef.current?.focus();
      handleInput();
    },
    [handleInput]
  );

  // Toolbar buttons configuration
  const toolbarButtons = [
    {
      command: "bold",
      icon: "B",
      title: "Bold",
      style: { fontWeight: "bold" },
    },
    {
      command: "italic",
      icon: "I",
      title: "Italic",
      style: { fontStyle: "italic" },
    },
    {
      command: "underline",
      icon: "U",
      title: "Underline",
      style: { textDecoration: "underline" },
    },
    {
      command: "strikeThrough",
      icon: "S",
      title: "Strikethrough",
      style: { textDecoration: "line-through" },
    },
    { separator: true },
    {
      command: "insertOrderedList",
      icon: (
        <span style={{ fontSize: "12px" }}>
          1.
          <br />─
        </span>
      ),
      title: "Numbered list",
    },
    {
      command: "insertUnorderedList",
      icon: (
        <span style={{ fontSize: "12px" }}>
          •
          <br />─
        </span>
      ),
      title: "Bulleted list",
    },
    {
      command: "insertCheckbox",
      icon: "☑",
      title: "Checkbox",
      customAction: () => {
        const checkbox = '<input type="checkbox" style="margin-right: 4px;" />';
        document.execCommand("insertHTML", false, checkbox);
        editorRef.current?.focus();
        handleInput();
      },
    },
    {
      command: "createLink",
      icon: (
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M6.88 9.12a3 3 0 0 1 0-4.24l2.24-2.24a3 3 0 1 1 4.24 4.24l-1.41 1.41"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M9.12 6.88a3 3 0 0 1 0 4.24l-2.24 2.24a3 3 0 1 1-4.24-4.24l1.41-1.41"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
      title: "Link",
      customAction: () => {
        const url = prompt("Enter URL:");
        if (url) {
          document.execCommand("createLink", false, url);
          editorRef.current?.focus();
          handleInput();
        }
      },
    },
  ];

  return (
    <div
      style={{
        border: "1px solid #D1D5DB",
        borderRadius: "4px",
        backgroundColor: disabled ? "#F9FAFB" : "#FFFFFF",
      }}
    >
      {/* Toolbar */}
      {!disabled && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            padding: "8px",
            borderBottom: "1px solid #E5E7EB",
            backgroundColor: "#F9FAFB",
            flexWrap: "wrap",
          }}
        >
          {toolbarButtons.map((btn, index) => {
            if (btn.separator) {
              return (
                <div
                  key={`sep-${index}`}
                  style={{
                    width: "1px",
                    height: "20px",
                    backgroundColor: "#D1D5DB",
                    margin: "0 4px",
                  }}
                />
              );
            }

            return (
              <button
                key={btn.command || index}
                type="button"
                onClick={() => {
                  if (btn.customAction) {
                    btn.customAction();
                  } else {
                    execCommand(btn.command);
                  }
                }}
                title={btn.title}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "28px",
                  height: "28px",
                  border: "none",
                  borderRadius: "4px",
                  backgroundColor: "transparent",
                  color: "#374151",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: btn.style?.fontWeight || "normal",
                  fontStyle: btn.style?.fontStyle || "normal",
                  textDecoration: btn.style?.textDecoration || "none",
                  ...btn.style,
                }}
                onMouseEnter={(e) => {
                  e.target.style.backgroundColor = "#E5E7EB";
                }}
                onMouseLeave={(e) => {
                  e.target.style.backgroundColor = "transparent";
                }}
              >
                {btn.icon}
              </button>
            );
          })}
        </div>
      )}

      {/* Editor */}
      <div
        ref={editorRef}
        contentEditable={!disabled}
        onInput={handleInput}
        onPaste={handlePaste}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        data-placeholder={placeholder || "Add a description..."}
        style={{
          minHeight: "200px",
          padding: "12px",
          fontSize: "14px",
          fontFamily: "inherit",
          lineHeight: "1.5",
          color: disabled ? "#6B7280" : "#111827",
          cursor: disabled ? "not-allowed" : "text",
          outline: "none",
          wordWrap: "break-word",
          overflowWrap: "break-word",
        }}
        suppressContentEditableWarning={true}
      />

      {/* Placeholder styles */}
      <style>
        {`
          [contenteditable][data-placeholder]:empty:before {
            content: attr(data-placeholder);
            color: #9CA3AF;
            pointer-events: none;
          }
        `}
      </style>
    </div>
  );
}
