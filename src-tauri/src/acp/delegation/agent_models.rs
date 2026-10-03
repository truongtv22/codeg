//! Last-known model choices per agent, for `delegate_to_agent` schema
//! enrichment.
//!
//! When a parent LLM delegates with a natural-language model ("use Opus"),
//! it needs the agent's REAL model ids — guessing one (`opus 5.5` vs
//! `claude-opus-5-5`) silently misses: the connection layer logs and skips,
//! and the child runs the default model. The id list is only knowable from
//! what an agent ADVERTISED at session start (`session/new` → config
//! options), so this registry remembers the most recent advertisement per
//! agent type, written from the two emit helpers every established session
//! passes through (`acp::connection`), probes included — opening the
//! Agent-defaults settings tab once per agent is enough to seed it.
//!
//! Consumers read [`snapshot`] at companion-launch time, where the map
//! travels to codeg-mcp as the `--agent-models` argv blob and is folded
//! into the tool description at `tools/list`.
//!
//! The map is persisted to `paths::codeg_delegation_models_file()` so the
//! enrichment survives restarts — without it, the first delegation after an
//! app start runs against an empty list and the parent LLM has to guess ids.
//! ponytail: the cached list is only refreshed when a session of that agent
//! establishes; an agent-side model rename stays stale until then.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::LazyLock;

use tokio::sync::Mutex;

use crate::acp::types::SessionConfigOptionInfo;
use crate::models::AgentType;

/// One selectable choice of the agent's model selector: the value id to pass
/// as `config_values.model`, and the human label the agent displays.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ModelChoice {
    pub value: String,
    pub name: String,
}

// Tests start from a deterministic empty map — disk load/save only runs in
// the real app (the round-trip helpers are exercised directly in tests).
#[cfg(not(test))]
static MODEL_OPTIONS: LazyLock<Mutex<BTreeMap<AgentType, Vec<ModelChoice>>>> =
    LazyLock::new(|| Mutex::new(load_from_disk_at(&crate::paths::codeg_delegation_models_file())));
#[cfg(test)]
static MODEL_OPTIONS: LazyLock<Mutex<BTreeMap<AgentType, Vec<ModelChoice>>>> =
    LazyLock::new(|| Mutex::new(BTreeMap::new()));

/// Is this config option the agent's model selector? ACP's spec-level signal
/// is `category: "model"`; every agent codeg drives also spells the id
/// `model` (see `connection::MODEL_CONFIG_OPTION_ID`).
fn is_model_option(option: &SessionConfigOptionInfo) -> bool {
    option.id == "model" || option.category.as_deref() == Some("model")
}

/// Extract the model choices from one session's advertised config options.
/// A non-Select model option (or an empty list) yields nothing — there is
/// nothing to advertise.
fn extract_choices(options: &[SessionConfigOptionInfo]) -> Vec<ModelChoice> {
    let mut choices = Vec::new();
    for option in options.iter().filter(|o| is_model_option(o)) {
        let crate::acp::types::SessionConfigKindInfo::Select(select) = &option.kind else {
            continue;
        };
        for entry in select
            .options
            .iter()
            .chain(select.groups.iter().flat_map(|g| &g.options))
        {
            choices.push(ModelChoice {
                value: entry.value.clone(),
                name: entry.name.clone(),
            });
        }
    }
    choices
}

/// Remember `choices` as `agent_type`'s current model list. A run with no
/// model selector does not erase a previous one — the stale list is still
/// the best hint available, and the child's own defaults win anyway.
pub async fn record(agent_type: AgentType, choices: Vec<ModelChoice>) {
    if choices.is_empty() {
        return;
    }
    let mut map = MODEL_OPTIONS.lock().await;
    map.insert(agent_type, choices);
    #[cfg(not(test))]
    write_to_disk_at(&crate::paths::codeg_delegation_models_file(), &map);
}

/// Read the persisted model cache. Malformed or missing file → empty map:
/// a broken cache must never block the companion from launching.
fn load_from_disk_at(path: &Path) -> BTreeMap<AgentType, Vec<ModelChoice>> {
    let Ok(raw) = std::fs::read(path) else {
        return BTreeMap::new();
    };
    match serde_json::from_slice(&raw) {
        Ok(map) => map,
        Err(e) => {
            tracing::warn!("ignoring unreadable agent-models cache {}: {e}", path.display());
            BTreeMap::new()
        }
    }
}

/// Persist the map. Best-effort — a failed write only costs cold-start
/// enrichment, never correctness.
fn write_to_disk_at(path: &Path, map: &BTreeMap<AgentType, Vec<ModelChoice>>) {
    let write = || -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, serde_json::to_vec_pretty(map)?)?;
        Ok(())
    };
    if let Err(e) = write() {
        tracing::warn!("could not persist agent-models cache {}: {e}", path.display());
    }
}

/// Record from a session's serialized config options, resolving the agent
/// type from the session state. The single write point shared by both emit
/// helpers in `acp::connection`.
pub async fn record_for_state(
    state: &tokio::sync::RwLock<crate::acp::session_state::SessionState>,
    options: &[SessionConfigOptionInfo],
) {
    let agent_type = state.read().await.agent_type;
    record(agent_type, extract_choices(options)).await;
}

/// Wire-slug-keyed copy of everything known, for the `--agent-models` arg.
pub async fn snapshot() -> BTreeMap<AgentType, Vec<ModelChoice>> {
    MODEL_OPTIONS.lock().await.clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::types::{SessionConfigKindInfo, SessionConfigSelectInfo};

    fn select_option(id: &str, category: Option<&str>, values: &[&str]) -> SessionConfigOptionInfo {
        SessionConfigOptionInfo {
            id: id.to_string(),
            name: id.to_string(),
            description: None,
            category: category.map(str::to_string),
            kind: SessionConfigKindInfo::Select(SessionConfigSelectInfo {
                current_value: values.first().map(|s| (*s).to_string()).unwrap_or_default(),
                options: values
                    .iter()
                    .map(|v| crate::acp::types::SessionConfigSelectOptionInfo {
                        value: (*v).to_string(),
                        name: (*v).to_string(),
                        description: None,
                    })
                    .collect(),
                groups: Vec::new(),
            }),
            recommended_value: None,
        }
    }

    #[tokio::test]
    async fn records_only_model_options_of_advertised_session() {
        let options = vec![
            select_option("model", Some("model"), &["claude-opus-5-5", "claude-sonnet-5-5"]),
            select_option("mode", Some("mode"), &["auto"]),
        ];
        let choices = extract_choices(&options);
        assert_eq!(choices.len(), 2);
        assert_eq!(choices[0].value, "claude-opus-5-5");
    }

    #[tokio::test]
    async fn empty_or_absent_list_does_not_erase_previous() {
        MODEL_OPTIONS.lock().await.clear();
        record(AgentType::Codex, extract_choices(&[])).await;
        assert!(!snapshot().await.contains_key(&AgentType::Codex));

        let options = vec![select_option("model", None, &["gpt-6"])];
        record(AgentType::Codex, extract_choices(&options)).await;
        assert_eq!(snapshot().await[&AgentType::Codex][0].value, "gpt-6");

        // A later session without a model selector keeps the last hint.
        record(AgentType::Codex, extract_choices(&[])).await;
        assert_eq!(snapshot().await[&AgentType::Codex][0].value, "gpt-6");
    }

    #[tokio::test]
    async fn grouped_select_values_are_flattened() {
        use crate::acp::types::{SessionConfigSelectGroupInfo, SessionConfigSelectOptionInfo};
        let mut option = select_option("model", Some("model"), &["visible-1"]);
        let crate::acp::types::SessionConfigKindInfo::Select(ref mut select) = option.kind else {
            unreachable!()
        };
        select.groups.push(SessionConfigSelectGroupInfo {
            group: "g".into(),
            name: "g".into(),
            options: vec![SessionConfigSelectOptionInfo {
                value: "grouped-1".into(),
                name: "Grouped 1".into(),
                description: None,
            }],
        });
        let choices = extract_choices(&[option]);
        let values: Vec<&str> = choices.iter().map(|c| c.value.as_str()).collect();
        assert_eq!(values, ["visible-1", "grouped-1"]);
    }

    #[test]
    fn disk_round_trip_preserves_entries_and_recovers_from_garbage() {
        let dir = std::env::temp_dir().join(format!("codeg-agent-models-{}", std::process::id()));
        let file = dir.join("agent-models.json");
        let mut map = BTreeMap::new();
        map.insert(
            AgentType::Antigravity,
            vec![ModelChoice {
                value: "gemini-3.7-flash-high".into(),
                name: "Gemini 3.7 Flash (High)".into(),
            }],
        );
        write_to_disk_at(&file, &map);
        assert_eq!(load_from_disk_at(&file), map);

        // A malformed cache degrades to empty, never panics or blocks.
        std::fs::write(&file, b"{not json").unwrap();
        assert!(load_from_disk_at(&file).is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }
}
