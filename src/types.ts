export type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "property"
  | "interface"
  | "type"
  | "const"
  | "enum"
  | "enumMember"
  | "module";

export type ContractFlag =
  | `annotation:${string}`
  | "deprecated"
  | "async"
  | "generator"
  | "abstract"
  | "readonly"
  | "static"
  | "unsafe"
  | "annotation-type";

export interface ParamShape {
  name?: string;
  type: string;
  optional: boolean;
  rest: boolean;
  hasDefault: boolean;
  kind?: string;
}

export interface MemberShape {
  name: string;
  kind: SymbolKind;
  optional: boolean;
  shape: Shape;
}

export interface EnumMemberShape {
  name: string;
  value: string;
  args?: string;
  argValues?: AnnotationArgument[];
}

export type AnnotationArgumentKind =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "class"
  | "array"
  | "annotation"
  | "expression";

export interface AnnotationArgument {
  name?: string;
  value: string;
  kind: AnnotationArgumentKind;
  literal?: string | number | boolean;
  items?: AnnotationArgument[];
}

export type EvaluatedValue =
  | string
  | number
  | boolean
  | null
  | EvaluatedValue[]
  | { [key: string]: EvaluatedValue };

export interface AnnotationShape {
  name: string;
  args?: AnnotationArgument[];
}

export interface Shape {
  kind: SymbolKind;
  async?: boolean;
  generator?: boolean;
  abstract?: boolean;
  typeParams?: string;
  params?: ParamShape[];
  returnType?: string;
  visibility?: string;
  flags?: ContractFlag[];
  extends?: string[];
  implements?: string[];
  members?: MemberShape[];
  typeShape?: string;
  literalKind?: string;
  enumMembers?: EnumMemberShape[];
  enumArgs?: AnnotationArgument[];
  annotations?: AnnotationShape[];
  defaultValue?: string;
  defaultKind?: AnnotationArgumentKind;
  defaultLiteral?: string | number | boolean;
  defaultItems?: AnnotationArgument[];
  evaluatedDefault?: EvaluatedValue;
  overload?: number;
}

export interface Symbol {
  id: string;
  name: string;
  kind: SymbolKind;
  modulePath: string;
  packageName: string;
  packageRoot: string;
  qualifiedName: string;
  aliases: string[];
  shape: Shape;
  shapeText: string;
  shapeHash: string;
  paramNamesHash: string;
  bodyHash: string;
  contractFlags: ContractFlag[];
  packageExport?: boolean;
  goReexport?: { packageName: string; receiver?: string; name: string };
  goValue?: string;
  parentId?: string;
  line: number;
  filePath: string;
}

export type Surface =
  | "inlineCode"
  | "headingCode"
  | "tableCode"
  | "fenceToken"
  | "signatureFence"
  | "explicitRef";

export interface ImportRef {
  source: string;
  imported: string;
}

export interface DocAnchor {
  docPath: string;
  line: number;
  column: number;
  length: number;
  token: string;
  occurrence: number;
  surface: Surface;
  fenceLang?: string;
  contextFp: string;
  importTable: Record<string, ImportRef>;
  localDecls: string[];
  hints?: string[];
  fragment: boolean;
  signatureShape?: Shape;
  explicitSymbol?: string;
}

export interface LockEntry {
  docPath: string;
  line?: number;
  contextFp: string;
  token: string;
  occurrence: number;
  symbolId: string;
  name: string;
  qualifiedName: string;
  kind: SymbolKind;
  shapeHash: string;
  shape: string;
  paramNamesHash: string;
  bodyHash: string;
  confidence: number;
}

export interface Tombstone {
  symbolId: string;
  name: string;
  qualifiedName: string;
  kind: SymbolKind;
  shapeHash: string;
  shape: string;
  bodyHash: string;
  removedInGeneration: number;
  renamedTo?: string;
}

export interface LockFile {
  schema: number;
  engine: string;
  generation: number;
  anchors: LockEntry[];
  tombstones: Tombstone[];
}

export type Rule =
  | "L1-broken"
  | "L2-moved"
  | "L3-reshaped"
  | "L4-renamed"
  | "S1-deprecated";

export type Severity = "error" | "warning" | "note" | "off";

export interface Fix {
  kind: "replaceToken" | "replacePath";
  from: string;
  to: string;
}

export interface Finding {
  id: string;
  rule: Rule;
  severity: Exclude<Severity, "off">;
  doc: { path: string; line: number; column: number; length: number };
  code?: { path: string; line: number; symbolId: string };
  message: string;
  suggestion?: string;
  fix?: Fix;
}

export interface Binding {
  anchor: DocAnchor;
  symbol: Symbol;
  score: number;
  evidence: string[];
}

export interface ResolveResult {
  binding?: Binding;
  candidates: Array<{ symbol: Symbol; score: number; evidence: string[] }>;
  reason: "bound" | "unbound" | "ambiguous" | "vetoed";
  veto?: string;
}

export interface ProjectStats {
  docsScanned: number;
  codeFilesScanned: number;
  symbols: number;
  anchors: number;
  bound: number;
  unbound: number;
  parseFailures: number;
}

export interface CheckResult {
  findings: Finding[];
  pending: Binding[];
  unbound: Array<{ anchor: DocAnchor; reason: string }>;
  stats: ProjectStats;
  lock: LockFile;
}

export interface LanguageConfig {
  typescript: boolean;
  python: boolean;
  rust: boolean;
  go: boolean;
  rustdoc: boolean;
}

export interface Config {
  docs: string[];
  exclude: string[];
  packages: string[];
  languages: LanguageConfig;
  severity: Record<Rule, Severity>;
  maxFindings: number;
  minConfidence: number;
  docstrings: boolean;
  asciidoc: boolean;
  javadoc: boolean;
  javaDefaults: boolean;
}

export const RULES: Rule[] = [
  "L1-broken",
  "L2-moved",
  "L3-reshaped",
  "L4-renamed",
  "S1-deprecated",
];
