import { Pinecone } from "@pinecone-database/pinecone";
import { PINECONE_INDEX, PINECONE_NAMESPACE } from "@/lib/config";

let _pc: Pinecone | null = null;

export function getPinecone(): Pinecone {
  if (!_pc) {
    _pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY ?? "" });
  }
  return _pc;
}

// Namespace-scoped index handle for integrated-inference search (text in, hits out).
export function getNamespace() {
  return getPinecone().index(PINECONE_INDEX).namespace(PINECONE_NAMESPACE);
}
