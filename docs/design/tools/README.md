# 设计材料生成与检查

这些程序生成图谱、设计合同与 SAMPLE 原型，并检查文件和原型逻辑。它们不是后端服务，也不会连接模型、数据 RPC、钱包或主网。不要把本地 crypto.js 当作已审计的生产密码学库。

无需运行脚本即可打开两份内嵌 HTML、阅读 Markdown 或查看 SVG/PNG。需要修改并再生成时，使用 Python 3 和支持本包语法的 Node.js；项目实际 Agent 运行栈按 PRD 的环境要求另行准备。

当前生成环境用到的直接依赖版本记录在 package.json 与 requirements.txt。它们不是生产应用依赖，也不构成完整传递依赖锁文件。安装应在独立开发环境审查依赖来源，发布应用另建真实锁文件与安全检查。

从设计包根目录按以下顺序执行。生成器会覆盖同包生成文件，改动前保留版本。

```bash
python3 tools/build_contracts.py
node tools/check_crypto_and_fixtures.js
python3 tools/build_prototype.py
python3 tools/extract_html.py
node tools/check_local_interactions.js
python3 tools/check_contracts.py
python3 tools/build_atlas_data.py
node tools/render_diagrams.js
python3 tools/build_documents.py
python3 tools/check_atlas.py
```

图谱的数据源为 build_atlas_data.py；生成 diagram_specs.json、中文 Mermaid 和场景目录。render_diagrams.js 使用 Graphviz WASM 生成 DOT/SVG，并用 sharp 生成 PNG。build_documents.py 将它们编为可离线浏览的文档。若手动编辑生成的 .mmd/.dot，下一次生成会覆盖；长期开发应选择并维护唯一源文件。

本地原型检查使用最小 DOM 替身，未覆盖浏览器排版或原生事件行为。图谱检查包含 HTML 结构和脚本语法，未模拟导航/缩放/搜索的实际浏览器操作。完整后端验收仍按 acceptance_cases.json 与 scenario_catalog.json 实施。

更新完成后重建 checks/file_manifest.json 与交付 ZIP；manifest 的 SHA-256 仅用于交付文件完整性，与业务报告 Keccak-256 的用途不同。
