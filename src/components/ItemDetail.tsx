import { List } from "@raycast/api";
import { buildDetail } from "../detail";
import type { NavItem } from "../fylgja/types";
import { tagIcon, toneColor } from "../ui/icons-map";

export function ItemDetail({
  item,
  pendingSummary,
  now,
}: {
  item: NavItem;
  pendingSummary: ReadonlySet<string>;
  now: number;
}) {
  const detail = buildDetail(item, { pendingSummary, now });
  return (
    <List.Item.Detail
      markdown={detail.markdown}
      metadata={
        <List.Item.Detail.Metadata>
          {detail.metadata.map((line, i) =>
            line.tags ? (
              <List.Item.Detail.Metadata.TagList key={`${i}:${line.label}`} title={line.label}>
                {line.tags.map((tag, j) => (
                  <List.Item.Detail.Metadata.TagList.Item
                    key={`${j}:${tag.text}`}
                    text={tag.text}
                    icon={tagIcon(tag)}
                    color={toneColor(tag.tone)}
                  />
                ))}
              </List.Item.Detail.Metadata.TagList>
            ) : (
              <List.Item.Detail.Metadata.Label key={`${i}:${line.label}`} title={line.label} text={line.text} />
            ),
          )}
        </List.Item.Detail.Metadata>
      }
    />
  );
}
