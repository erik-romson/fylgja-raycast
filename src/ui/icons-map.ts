/** Maps the pure row descriptors to Raycast values. UI side of R2. */
import { Color, Icon, Keyboard, type Image, type List } from "@raycast/api";
import type { IconDescriptor } from "../icons";
import type { ShortcutDescriptor } from "../item-actions";
import type { AccessoryModel, Tone } from "../rows";

export function toIcon(descriptor: IconDescriptor): Image.ImageLike {
  return descriptor.type === "file" ? { fileIcon: descriptor.path } : Icon[descriptor.name];
}

export function toShortcut(descriptor: ShortcutDescriptor): Keyboard.Shortcut {
  if ("common" in descriptor) return Keyboard.Shortcut.Common[descriptor.common];
  return { modifiers: descriptor.modifiers, key: descriptor.key as Keyboard.KeyEquivalent };
}

export function toneColor(tone: Tone): Color {
  switch (tone) {
    case "urgent":
      return Color.Red;
    case "warning":
      return Color.Orange;
    default:
      return Color.SecondaryText;
  }
}

export function toAccessory(model: AccessoryModel): List.Item.Accessory {
  const color = toneColor(model.tone);
  const accessory: List.Item.Accessory =
    model.tone === "urgent" || model.tone === "warning"
      ? { tag: { value: model.text, color } }
      : { text: { value: model.text, color } };
  if (model.tooltip !== undefined) accessory.tooltip = model.tooltip;
  return accessory;
}
