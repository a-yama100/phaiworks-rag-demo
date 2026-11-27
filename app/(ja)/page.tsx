import { HomePage } from "@/components/HomePage";
import { pageMetadata } from "../_meta";

export const metadata = pageMetadata("ja", "home");

export default function Home() {
  return <HomePage lang="ja" />;
}
