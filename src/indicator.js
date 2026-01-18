const APP_ID = "notes-app";
const INDICATOR_SIZE = 24;
const INDICATOR_OFFSET = 8;

async function isEditor(item) {
  if (!item) {
    return false;
  }

  try {
    const currentUserInfo = await miro.board.getUserInfo();
    const currentUserId = currentUserInfo.id;
    const createdBy = item.createdBy;

    return currentUserId && createdBy === currentUserId;
  } catch (error) {
    console.error("Error checking editor status:", error);
    return false;
  }
}

function calculateIndicatorPosition(item) {
  const bounds = item.bounds;
  if (!bounds) {
    return null;
  }

  const x = bounds.x + bounds.width - INDICATOR_SIZE / 2 - INDICATOR_OFFSET;
  const y =
    bounds.y - bounds.height / 2 + INDICATOR_SIZE / 2 + INDICATOR_OFFSET;

  return { x, y };
}

export async function createIndicator(item) {
  if (!(await isEditor(item))) {
    return null;
  }

  try {
    const metadata = await item.getMetadata(APP_ID);
    if (metadata?.indicatorWidgetId) {
      try {
        const existingWidget = await miro.board.getById(
          metadata.indicatorWidgetId
        );
        if (existingWidget) {
          return metadata.indicatorWidgetId;
        }
      } catch (error) {}
    }

    const position = calculateIndicatorPosition(item);
    if (!position) {
      console.warn("Cannot calculate indicator position for item:", item.id);
      return null;
    }

    const indicatorWidget = await miro.board.createText({
      content: "📝",
      style: {
        fillColor: "transparent",
        textAlign: "center",
        textAlignVertical: "middle",
      },
      x: position.x,
      y: position.y,
      width: INDICATOR_SIZE,
      height: INDICATOR_SIZE,
    });

    await item.setMetadata(APP_ID, {
      ...metadata,
      indicatorWidgetId: indicatorWidget.id,
    });

    return indicatorWidget.id;
  } catch (error) {
    console.error("Error creating indicator:", error);
    return null;
  }
}

export async function updateIndicatorPosition(item) {
  if (!(await isEditor(item))) {
    return;
  }

  try {
    const metadata = await item.getMetadata(APP_ID);
    if (!metadata?.indicatorWidgetId) {
      return;
    }

    let indicatorWidget;
    try {
      indicatorWidget = await miro.board.getById(metadata.indicatorWidgetId);
    } catch (error) {
      const updatedMetadata = { ...metadata };
      delete updatedMetadata.indicatorWidgetId;
      await item.setMetadata(APP_ID, updatedMetadata);
      return;
    }

    const position = calculateIndicatorPosition(item);
    if (!position) {
      return;
    }

    await indicatorWidget.set({ x: position.x, y: position.y });
  } catch (error) {
    console.error("Error updating indicator position:", error);
  }
}

export async function deleteIndicator(item) {
  if (!(await isEditor(item))) {
    return;
  }

  try {
    const metadata = await item.getMetadata(APP_ID);
    if (!metadata?.indicatorWidgetId) {
      return;
    }

    try {
      const indicatorWidget = await miro.board.getById(
        metadata.indicatorWidgetId
      );
      await miro.board.remove([indicatorWidget]);
    } catch (error) {}

    const updatedMetadata = { ...metadata };
    delete updatedMetadata.indicatorWidgetId;
    await item.setMetadata(APP_ID, updatedMetadata);
  } catch (error) {
    console.error("Error deleting indicator:", error);
  }
}

export async function syncIndicator(item, notes) {
  if (!(await isEditor(item))) {
    return;
  }

  const hasNotes = notes && notes.trim().length > 0;

  if (hasNotes) {
    await createIndicator(item);
  } else {
    await deleteIndicator(item);
  }
}

function throttle(func, limit) {
  let inThrottle;
  return function (...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

export const throttledUpdateIndicatorPosition = throttle(
  updateIndicatorPosition,
  100
);
