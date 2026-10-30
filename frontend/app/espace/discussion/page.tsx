import type { Metadata } from "next";
import { DiscussionView } from "./discussion-view";

export const metadata: Metadata = { title: "Discussion" };

export default function DiscussionPage() {
  return <DiscussionView />;
}
