import { HeySmallest } from "@/components/HeySmallest";
import { PAGE_BRIEF } from "@/lib/catalog";

const pageContext = {
  url: "https://docs.smallest.ai",
  title: "Smallest AI Documentation",
  text: PAGE_BRIEF,
};

export default function Page() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-16 text-ink">
      <HeySmallest endpoint="" pageContext={pageContext} />
    </main>
  );
}
