fn extract_trycloudflare_url(log_output: &str) -> Option<String> {
    for line in log_output.lines() {
        if line.contains(".trycloudflare.com") {
            if let Some(start_idx) = line.find("https://") {
                let rest = &line[start_idx..];
                let end_idx = rest.find(|c: char| c.is_whitespace() || c == '|' || c == '"' || c == '\'').unwrap_or(rest.len());
                let url = &rest[..end_idx];
                // Yalnız .trycloudflare.com olan düzgün url-i qaytarırıq
                if url.contains(".trycloudflare.com") {
                    return Some(url.trim().to_string());
                }
            }
        }
    }
    None
}

fn generate_cloudflare_kv_key(app_name: &str, port: i64) -> String {
    let clean_name = app_name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect::<String>();
    format!("{}:{}", clean_name, port)
}

#[test]
fn test_standard_cloudflared_log_url_extraction() {
    let sample_log = r#"
2026-09-09T18:30:15Z INF +--------------------------------------------------------------------------------------------+
2026-09-09T18:30:15Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
2026-09-09T18:30:15Z INF |  https://rapidly-testing-zone-abc.trycloudflare.com                                          |
2026-09-09T18:30:15Z INF +--------------------------------------------------------------------------------------------+
2026-09-09T18:30:16Z INF Cannot determine default configuration path. No file [config.yml config.yaml] in [~/.cloudflared]
"#;

    let extracted = extract_trycloudflare_url(sample_log);
    assert!(extracted.is_some(), "trycloudflare linki mütləq tapılmalıdır");
    assert_eq!(
        extracted.unwrap(),
        "https://rapidly-testing-zone-abc.trycloudflare.com"
    );
}

#[test]
fn test_url_extraction_with_noisy_and_empty_logs() {
    let noisy_log = "2026-09-09 INF Starting tunnel...\n2026-09-09 WRN Retrying connection\n2026-09-09 INF Connected to edge";
    assert_eq!(extract_trycloudflare_url(noisy_log), None, "Link olmayan loqda None qayıtmalıdır");

    let inline_log = "Registered tunnel endpoint at https://my-subdomain.trycloudflare.com with latency 14ms";
    assert_eq!(
        extract_trycloudflare_url(inline_log),
        Some("https://my-subdomain.trycloudflare.com".to_string())
    );
}

#[test]
fn test_cloudflare_kv_key_generation() {
    let key1 = generate_cloudflare_kv_key("Mezuniyyet API", 8080);
    assert_eq!(key1, "mezuniyyet-api:8080");

    let key2 = generate_cloudflare_kv_key("crm_service-v2!", 3000);
    assert_eq!(key2, "crm_service-v2-:3000");
}
