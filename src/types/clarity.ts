export type DatabaseProvider = "oracle" | "postgres" | "mysql" | "sqlite";
export type OracleAuthMode = "normal" | "sysdba";

export interface OracleConnectionOptions {
  host: string;
  port?: number;
  serviceName: string;
  username: string;
  schema: string;
  oracleAuthMode: OracleAuthMode;
}

export interface OracleConnectOptions extends OracleConnectionOptions {
  password: string;
  oracleClientLibDir?: string;
}

export interface NetworkConnectionOptions {
  host: string;
  port?: number;
  database: string;
  username: string;
  schema?: string;
}

export interface NetworkConnectOptions extends NetworkConnectionOptions {
  password: string;
}

export interface SqliteConnectionOptions {
  filePath: string;
}

export type DbConnectRequest =
  | { provider: "oracle"; connection: OracleConnectOptions }
  | { provider: "postgres"; connection: NetworkConnectOptions }
  | { provider: "mysql"; connection: NetworkConnectOptions }
  | { provider: "sqlite"; connection: SqliteConnectionOptions };

export type OracleDbConnectRequest = Extract<
  DbConnectRequest,
  { provider: "oracle" }
>;

export interface DbSessionSummary {
  sessionId: number;
  displayName: string;
  schema: string;
  provider: DatabaseProvider;
}

export interface SchemaExportTarget {
  sessionId: number;
  label: string;
  schema: string;
  provider: DatabaseProvider;
}

export interface SchemaExportResult {
  destinationDirectory: string;
  objectCount: number;
  fileCount: number;
  skippedCount: number;
  message: string;
}

export interface DbTransactionState {
  active: boolean;
}

export type DbConnectionProfile =
  | { provider: "oracle"; connection: OracleConnectionOptions }
  | { provider: "postgres"; connection: NetworkConnectionOptions }
  | { provider: "mysql"; connection: NetworkConnectionOptions }
  | { provider: "sqlite"; connection: SqliteConnectionOptions };

export type ConnectionProfile = {
  id: string;
  name: string;
  hasPassword: boolean;
} & DbConnectionProfile;

export type OracleConnectionProfile = Extract<
  ConnectionProfile,
  { provider: "oracle" }
>;

export type SaveConnectionProfileRequest = {
  id?: string | null;
  name: string;
  savePassword: boolean;
  password?: string | null;
} & DbConnectionProfile;

export interface DbObjectEntry {
  schema: string;
  objectType: string;
  objectName: string;
}

export interface DbObjectColumnEntry {
  schema: string;
  objectName: string;
  columnName: string;
  dataType: string;
  nullable: string;
}

export type SqlCompletionSchema = Record<string, Record<string, string[]>>;

export interface AiSchemaContextObject {
  schema: string;
  objectName: string;
  columns: string[];
  isReferencedInQuery: boolean;
}

export interface AiQuerySuggestionRequest {
  currentSql: string;
  connectedSchema: string;
  endpoint: string;
  model: string;
  schemaContext: AiSchemaContextObject[];
  cursorClause?: string;
}

export interface AiQuerySuggestionResponse {
  suggestionText: string;
  confidence: number;
  reasoningShort: string;
  isPotentiallyMutating: boolean;
}

export interface DbQueryResult {
  columns: string[];
  rows: string[][];
  rowsAffected: number | null;
  message: string;
}

export type SchemaSearchMatchScope = "object_name" | "source" | "ddl";

export interface DbSchemaSearchResult {
  schema: string;
  objectType: string;
  objectName: string;
  matchScope: SchemaSearchMatchScope;
  line: number | null;
  snippet: string;
}

export type ObjectDetailTabId = "data" | "ddl" | "metadata";

export interface ObjectDetailTabDefinition {
  id: ObjectDetailTabId;
  label: string;
}

export interface WorkspaceDdlTab {
  id: string;
  object: DbObjectEntry;
  ddlText: string;
  focusLine: number | null;
  focusToken: number;
  activeDetailTabId: ObjectDetailTabId;
  dataResult: DbQueryResult | null;
  metadataResult: DbQueryResult | null;
  loadingDdl: boolean;
  loadingData: boolean;
  loadingMetadata: boolean;
}

export interface WorkspaceQueryTab {
  id: string;
  title: string;
  queryText: string;
  resultPanes: WorkspaceQueryResultPane[];
  activeResultPaneId: string;
  nextResultPaneNumber: number;
}

export interface WorkspaceQueryResultPane {
  id: string;
  title: string;
  queryResult: DbQueryResult | null;
  errorMessage: string;
  sourceSql: string | null;
  sourceSessionId: number | null;
  sourceRowLimit: number | null;
}

export interface BusyState {
  connecting: boolean;
  loadingProfiles: boolean;
  savingProfile: boolean;
  deletingProfile: boolean;
  loadingProfileSecret: boolean;
  loadingObjects: boolean;
  loadingDdl: boolean;
  savingDdl: boolean;
  runningQuery: boolean;
  managingTransaction: boolean;
  updatingData: boolean;
  exportingSchema: boolean;
  searchingSchema: boolean;
}

export interface ObjectTreeNode {
  objectType: string;
  entries: DbObjectEntry[];
}
