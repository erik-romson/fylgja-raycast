/** Maps the pure row descriptors to Raycast values. UI side of R2. */
import { Color, Icon, Keyboard, type Image, type List } from "@raycast/api";
import type { IconDescriptor } from "../icons";
import type { ShortcutDescriptor } from "../item-actions";
import type { AccessoryModel, TagSource, Tone } from "../rows";

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

/** The Octicons (MIT, `assets/octicons/LICENSE`) stand in where Raycast has no git or pull request icon. */
const SOURCE_ICONS: Record<TagSource, Image.Source> = {
  agent: Icon.Stars,
  run: Icon.Play,
  ci: Icon.Hammer,
  review: "octicons/code-review.svg",
  pr: "octicons/git-pull-request.svg",
  git: "octicons/diff.svg",
  todo: Icon.CheckList,
  unread: Icon.Envelope,
};

/** The tag's source as an icon in the tag's color, if it has a source. */
export function tagIcon(model: AccessoryModel): Image.ImageLike | undefined {
  return model.source ? { source: SOURCE_ICONS[model.source], tintColor: toneColor(model.tone) } : undefined;
}

export function toAccessory(model: AccessoryModel): List.Item.Accessory {
  const color = toneColor(model.tone);
  const accessory: List.Item.Accessory =
    model.tone === "urgent" || model.tone === "warning"
      ? { tag: { value: model.text, color } }
      : { text: { value: model.text, color } };
  const icon = tagIcon(model);
  if (icon) accessory.icon = icon;
  if (model.tooltip !== undefined) accessory.tooltip = model.tooltip;
  return accessory;
}
