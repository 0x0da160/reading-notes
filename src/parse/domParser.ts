import { parserInput } from '../trusted';

export function parseXml(text: string, type: DOMParserSupportedType): Document {
  return new DOMParser().parseFromString(parserInput(text), type);
}

export function hasParseError(doc: Document): boolean {
  return doc.getElementsByTagName('parsererror').length > 0;
}
