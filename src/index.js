export async function init() {
  miro.board.ui.on("icon:click", async () => {
    await miro.board.ui.openPanel({ url: "app.html" });
  });

  const eventName = "open-notes";

  try {
    miro.board.ui.on(`custom:${eventName}`, async () => {
      await miro.board.ui.openPanel({ url: "app.html" });
    });

    await miro.board.experimental.action.register({
      event: eventName,
      ui: {
        label: "Open Notes",
        icon: "calendar-blank", // Custom SVG icon as data URI
        description: "Open the notes panel for this item",
      },
      predicate: {
        $or: [{ type: "shape" }, { type: "text" }, { type: "sticky_note" }],
      },
      contexts: {
        item: {},
      },
    });
  } catch (error) {
    console.error("Error registering custom action:", error);
  }
}

init();
