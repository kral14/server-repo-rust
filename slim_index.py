with open(r"MasterDeploy-rust/static/index.html", "r", encoding="utf-8") as f:
    content = f.read()

start_marker = "<!-- BEGIN TAB: dashboard.html -->"
end_marker = '<script src="https://cdn.jsdelivr.net/npm/chart.js">'

s_idx = content.find(start_marker)
e_idx = content.find(end_marker)

if s_idx == -1 or e_idx == -1:
    print(f"ERROR: {s_idx}, {e_idx}")
    exit(1)

middle = "        </main>\n    </div>\n\n    <!-- Dynamic Modals Container -->\n    <div id=\"dynamic-modals-container\"></div>\n\n    "
new_c = content[:s_idx] + middle + content[e_idx:]

with open(r"MasterDeploy-rust/static/index.html", "w", encoding="utf-8") as f:
    f.write(new_c)

print(f"Success! Total lines in index.html: {len(new_c.splitlines())}")
