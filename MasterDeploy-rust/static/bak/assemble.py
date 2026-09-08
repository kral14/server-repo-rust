import os

# 1. Read static/index.html to get head/sidebar (up to <main class="main-content">)
with open(r"MasterDeploy-rust\static\index.html", "r", encoding="utf-8") as f:
    text = f.read()

# Find exact start of <main class="main-content">
main_tag = '<main class="main-content">'
main_idx = text.find(main_tag)
if main_idx == -1:
    raise Exception("Could not find <main class=\"main-content\">")

head_and_sidebar = text[:main_idx + len(main_tag)]

# Find exact start of bottom scripts
script_tag = '<script src="https://cdn.jsdelivr.net/npm/chart.js">'
script_idx = text.find(script_tag)
if script_idx == -1:
    raise Exception("Could not find script_tag")

footer = text[script_idx:]

# 2. Tabs to include (autodeploy is now inside background_services.html!)
tabs = [
    "dashboard.html",
    "servers.html",
    "keys_tokens.html",
    "applications.html",
    "app_details.html",
    "background_services.html"
]

modals = [
    "server_modal.html",
    "server_edit_modal.html",
    "app_modal.html",
    "github_modal.html",
    "plugins_modal.html",
    "help_modal.html",
    "confirm_card_modal.html",
    "system_update_modal.html",
    "activity_log_modal.html",
    "log_detail_modal.html",
    "delete_terminal_modal.html",
    "create_service_modal.html",
    "cloudflare_setup_modal.html",
    "cloudflare_help_modal.html",
    "server_conn_modal.html",
    "server_console_modal.html",
    "server_volumes_modal.html"
]

tabs_content = []
for t in tabs:
    p = os.path.join(r"MasterDeploy-rust\static\tabs", t)
    with open(p, "r", encoding="utf-8") as tf:
        clean_content = tf.read().strip()
        tabs_content.append(f"\n<!-- BEGIN TAB: {t} -->\n" + clean_content + f"\n<!-- END TAB: {t} -->\n")

modals_content = []
for m in modals:
    p = os.path.join(r"MasterDeploy-rust\static\modals", m)
    with open(p, "r", encoding="utf-8") as mf:
        clean_content = mf.read().strip()
        modals_content.append(f"\n<!-- BEGIN MODAL: {m} -->\n" + clean_content + f"\n<!-- END MODAL: {m} -->\n")

new_index = head_and_sidebar + "\n"
new_index += "".join(tabs_content) + "\n"
new_index += "        </main>\n    </div>\n\n"
new_index += "".join(modals_content) + "\n\n"
new_index += footer

with open(r"MasterDeploy-rust\static\index.html", "w", encoding="utf-8") as out:
    out.write(new_index)

print(f"Clean assembly done! Total lines: {len(new_index.splitlines())}")
