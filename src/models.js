// Data models and utilities for sections and notes

// Generate unique IDs
export const generateId = () =>
  `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// Section model
export const createSection = (name, order = 0) => ({
  id: generateId(),
  name: name || "New Section",
  order,
  notes: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

// Note model
export const createNote = (
  itemId,
  itemName,
  itemType,
  sectionId,
  heading = "",
  body = "",
  authorId = null,
  order = 0
) => ({
  id: generateId(),
  heading: heading || itemName || itemType || "Untitled",
  body: body || "",
  itemId,
  itemName: itemName || itemType || "Untitled",
  itemType,
  sectionId,
  order,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  authorId,
});

// Metadata schema
export const createMetadataStructure = (authorId) => ({
  schemaVersion: "1.0.0",
  sections: [createSection("General", 0)],
  updatedAt: Date.now(),
  authorId,
});

// Get default section (General)
export const getDefaultSection = (sections) => {
  if (!sections || sections.length === 0) {
    return createSection("General", 0);
  }
  return sections.find((s) => s.name === "General") || sections[0];
};

// Sort sections by order
export const sortSections = (sections) => {
  return [...sections].sort((a, b) => a.order - b.order);
};

// Sort notes by order
export const sortNotes = (notes) => {
  return [...notes].sort((a, b) => a.order - b.order);
};
