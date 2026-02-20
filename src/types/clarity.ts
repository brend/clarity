export type DatabaseProvider = "oracle" | "postgres" | "mysql" | "sqlite";

export interface OracleConnectRequest {
  provider: DatabaseProvider;
  host: string;
  port?: number;
  serviceName: string;
  username: string;
  password: string;
  schema: string;
}

export interface OracleSessionSummary {
  sessionId: number;
  displayName: string;
  schema: string;
  provider: DatabaseProvider;
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

export interface OracleQueryResult {
  columns: string[];
  rows: string[][];
  rowsAffected: number | null;
  message: string;
}

export interface OracleSourceSearchResult {
  schema: string;
  objectType: string;
  objectName: string;
  line: number;
  text: string;
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
  searchingSource: boolean;
}

export interface ObjectTreeNode {
  objectType: string;
  entries: OracleObjectEntry[];
}
