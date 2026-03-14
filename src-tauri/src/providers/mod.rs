pub(crate) mod oracle;

use crate::types::{
    DatabaseProvider, DbConnectRequest, DbSchemaSearchRequest, DbSchemaSearchResult,
    OracleDdlUpdateRequest, OracleFilteredQueryRequest, OracleObjectColumnEntry, OracleObjectEntry,
    OracleObjectRef, OracleQueryRequest, OracleQueryResult,
};

pub(crate) struct AppSession {
    pub(crate) provider: DatabaseProvider,
    pub(crate) session: ProviderSession,
}

pub(crate) enum ProviderSession {
    Oracle(oracle::OracleSession),
}

pub(crate) struct ProviderRegistry;

impl ProviderRegistry {
    pub(crate) fn connect(
        request: &DbConnectRequest,
    ) -> Result<(AppSession, String, String), String> {
        match request.provider {
            DatabaseProvider::Oracle => {
                let (session, display_name, schema) = oracle::connect(request)?;
                Ok((
                    AppSession {
                        provider: DatabaseProvider::Oracle,
                        session: ProviderSession::Oracle(session),
                    },
                    display_name,
                    schema,
                ))
            }
            DatabaseProvider::Postgres | DatabaseProvider::Mysql | DatabaseProvider::Sqlite => {
                Err(not_implemented_error(request.provider))
            }
        }
    }

    pub(crate) fn list_objects(session: &AppSession) -> Result<Vec<OracleObjectEntry>, String> {
        match (session.provider, &session.session) {
            (DatabaseProvider::Oracle, ProviderSession::Oracle(oracle_session)) => {
                oracle::list_objects(oracle_session)
            }
            (provider, _) => Err(not_implemented_error(provider)),
        }
    }

    pub(crate) fn list_object_columns(
        session: &AppSession,
    ) -> Result<Vec<OracleObjectColumnEntry>, String> {
        match (session.provider, &session.session) {
            (DatabaseProvider::Oracle, ProviderSession::Oracle(oracle_session)) => {
                oracle::list_object_columns(oracle_session)
            }
            (provider, _) => Err(not_implemented_error(provider)),
        }
    }

    pub(crate) fn get_object_ddl(
        session: &AppSession,
        request: &OracleObjectRef,
    ) -> Result<String, String> {
        match (session.provider, &session.session) {
            (DatabaseProvider::Oracle, ProviderSession::Oracle(oracle_session)) => {
                oracle::get_object_ddl(oracle_session, request)
            }
            (provider, _) => Err(not_implemented_error(provider)),
        }
    }

    pub(crate) fn update_object_ddl(
        session: &mut AppSession,
        request: &OracleDdlUpdateRequest,
    ) -> Result<String, String> {
        match (session.provider, &mut session.session) {
            (DatabaseProvider::Oracle, ProviderSession::Oracle(oracle_session)) => {
                oracle::update_object_ddl(oracle_session, request)
            }
            (provider, _) => Err(not_implemented_error(provider)),
        }
    }

    pub(crate) fn run_query(
        session: &mut AppSession,
        request: &OracleQueryRequest,
    ) -> Result<OracleQueryResult, String> {
        match (session.provider, &mut session.session) {
            (DatabaseProvider::Oracle, ProviderSession::Oracle(oracle_session)) => {
                oracle::run_query(oracle_session, request)
            }
            (provider, _) => Err(not_implemented_error(provider)),
        }
    }

    pub(crate) fn run_filtered_query(
        session: &mut AppSession,
        request: &OracleFilteredQueryRequest,
    ) -> Result<OracleQueryResult, String> {
        match (session.provider, &mut session.session) {
            (DatabaseProvider::Oracle, ProviderSession::Oracle(oracle_session)) => {
                oracle::run_filtered_query(oracle_session, request)
            }
            (provider, _) => Err(not_implemented_error(provider)),
        }
    }

    pub(crate) fn search_schema_text(
        session: &AppSession,
        request: &DbSchemaSearchRequest,
    ) -> Result<Vec<DbSchemaSearchResult>, String> {
        match (session.provider, &session.session) {
            (DatabaseProvider::Oracle, ProviderSession::Oracle(oracle_session)) => {
                oracle::search_schema_text(oracle_session, request)
            }
            (provider, _) => Err(not_implemented_error(provider)),
        }
    }

    pub(crate) fn begin_transaction(session: &mut AppSession) -> Result<bool, String> {
        match (session.provider, &mut session.session) {
            (DatabaseProvider::Oracle, ProviderSession::Oracle(oracle_session)) => {
                oracle::begin_transaction(oracle_session)
            }
            (provider, _) => Err(not_implemented_error(provider)),
        }
    }

    pub(crate) fn commit_transaction(session: &mut AppSession) -> Result<bool, String> {
        match (session.provider, &mut session.session) {
            (DatabaseProvider::Oracle, ProviderSession::Oracle(oracle_session)) => {
                oracle::commit_transaction(oracle_session)
            }
            (provider, _) => Err(not_implemented_error(provider)),
        }
    }

    pub(crate) fn rollback_transaction(session: &mut AppSession) -> Result<bool, String> {
        match (session.provider, &mut session.session) {
            (DatabaseProvider::Oracle, ProviderSession::Oracle(oracle_session)) => {
                oracle::rollback_transaction(oracle_session)
            }
            (provider, _) => Err(not_implemented_error(provider)),
        }
    }

    pub(crate) fn transaction_active(session: &AppSession) -> Result<bool, String> {
        match (session.provider, &session.session) {
            (DatabaseProvider::Oracle, ProviderSession::Oracle(oracle_session)) => {
                Ok(oracle::transaction_active(oracle_session))
            }
            (provider, _) => Err(not_implemented_error(provider)),
        }
    }
}

fn not_implemented_error(provider: DatabaseProvider) -> String {
    format!("Provider '{}' is not implemented yet.", provider.label())
}
