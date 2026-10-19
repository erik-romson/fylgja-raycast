import { List } from "@raycast/api";
import { buildDetail } from "../detail";
import type { NavItem } from "../fylgja/types";

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
          {detail.metadata.map((line, i) => (
            <List.Item.Detail.Metadata.Label key={`${i}:${line.label}`} title={line.label} text={line.text} />
          ))}
        </List.Item.Detail.Metadata>
      }
    />
  );
}
