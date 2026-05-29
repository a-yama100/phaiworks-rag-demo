import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";
import { PINECONE_INDEX } from "@/lib/config";

let _openai: OpenAI | null = null;
let _index: ReturnType<Pinecone["index"]> | null = null;

export function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

export function getIndex(): ReturnType<Pinecone["index"]> {
  if (!_index) {
    const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY ?? "" });
    _index = pc.index(PINECONE_INDEX);
  }
  return _index;
}
