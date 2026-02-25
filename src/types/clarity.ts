export type DatabaseProvider = "oracle" | "postgres" | "mysql" | "sqlite";

export interface OracleConnectRequest {
  provider: DatabaseProvider;
  host: string;
  port?: number;
  serviceName: string;
  username: string;
  password: string;
  schema: string;
  oracleClientLibDir?: string;
}

export interface OracleSessionSummary {
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

export interface ConnectionProfile {
  id: string;
  name: string;
  provider: DatabaseProvider;
  host: string;
  port?: number;
  serviceName: string;
  username: string;
  schema: string;
  hasPassword: boolean;
}

export interface OracleObjectEntry {
  schema: string;
  objectType: string;
  objectName: string;
}

export interface OracleObjectColumnEntry {
  schema: string;
  objectName: string;
  columnName: string;
}

export type SqlCompletionSchema = Record<string, Record<string, string[]>>;

export interface OracleQueryResult {
  columns: string[];
  rows: string[][];
  rowsAffected: number | null;
  message: string;
}

export type SchemaSearchMatchScope = "object_name" | "source" | "ddl";

export interface OracleSchemaSearchResult {
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
  object: OracleObjectEntry;
  ddlText: string;
  focusLine: number | null;
  focusToken: number;
  activeDetailTabId: ObjectDetailTabId;
  dataResult: OracleQueryResult | null;
  metadataResult: OracleQueryResult | null;
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
  queryResult: OracleQueryResult | null;
  errorMessage: string;
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
  updatingData: boolean;
  exportingSchema: boolean;
  searchingSchema: boolean;
}

export interface ObjectTreeNode {
  objectType: string;
  entries: OracleObjectEntry[];
}
