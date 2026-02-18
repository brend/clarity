pub(crate) mod oracle;

use crate::{
    DbConnectRequest, OracleDdlUpdateRequest, OracleObjectEntry, OracleObjectRef,
    OracleQueryRequest, OracleQueryResult,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DatabaseProvider {
    Oracle,
    Postgres,
    Mysql,
    Sqlite,
}

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
}

impl DatabaseProvider {
    pub(crate) fn label(self) -> &'static str {
        match self {
            DatabaseProvider::Oracle => "oracle",
            DatabaseProvider::Postgres => "postgres",
            DatabaseProvider::Mysql => "mysql",
            DatabaseProvider::Sqlite => "sqlite",
        }
    }
}

fn not_implemented_error(provider: DatabaseProvider) -> String {
    format!("Provider '{}' is not implemented yet.", provider.label())
}
