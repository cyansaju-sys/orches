# What is new

Each version has its own `## x.y.z` section with sentences written for people who use the app. Tutti shows them once, the first time it opens after updating. This file is the English version of CHANGELOG.md.

## 1.0.8

- **Codex now connects to task delegation:** when opened from Tutti it sees `list_agents`, `delegate_task`, `wait_agent` and `read_agent_output`, without touching its `config.toml`.
- **Tutti's MCP, in plain sight:** the MCP tab has a global “tutti” card showing which agents it applies to and warning if Antigravity's one points to a path that no longer exists (it is repaired when Tutti opens).
- **Spanish and English:** the gear menu has a *Language* submenu (Automatic, Spanish, English). It switches the whole interface instantly and is remembered on reopening.
- **MCP server store:** in the MCP tab you can search the official registry, see a server's page (what it is, who publishes it and the exact command) and install it in your agents. The best-known ones come first, under *Recommended*.
- **One server, one card:** installed MCP servers are no longer split by agent; opening a card shows which ones it is applied to, and you can remove it from one or from all. Sections can be collapsed.
- **Copy and paste in terminals and agents:** `Ctrl+C` (with text selected), `Ctrl+V`, `Ctrl+Shift+V` and `Shift+Insert`, plus a right-click menu. Clipboard images still reach Claude Code.
- **Softer light theme:** no pure white, so it is easier on the eyes.
- **Better menus:** submenus open on hover, with the current value, separators and no gaps; the highlight in the file tree follows the mouse and the menu key opens the menu of the marked row.
- **Opens where you look:** the window appears on the monitor where the cursor is.

## 1.0.7

- **Orches is now called Tutti.** Your settings and project context are kept. If you installed it with the script, run it again so the command becomes `tutti`; otherwise the app updates itself.
- **Search in the project (Ctrl+Shift+F):** like in VS Code: match case, whole word and regular expressions, with include and exclude file filters. Results are grouped by file and clicking one opens it at that line. It respects .gitignore.
- **Find and replace:** `Ctrl+Shift+H` adds the replace field across the whole project (per file or all at once; files with unsaved changes are skipped) and `Ctrl+H` opens replace inside the open file. The editor's find box is new: floating, smaller and translated.
- **New empty window:** a button in the title bar and an option in the launcher menu to open another Tutti window with no project, with its own agents.
- **Antigravity now connects to task delegation:** it used to open without Tutti's tools. Now, when opened from Tutti, it sees `list_agents`, `delegate_task`, `wait_agent` and `read_agent_output`. Tutti registers a “tutti” server in Antigravity's MCP configuration (`~/.gemini/config/mcp_config.json`); outside Tutti that server offers no tools.
- **Light and dark theme:** the gear at the bottom of the sidebar opens a menu to choose *Dark theme*, *Light theme* or *Automatic* (follows the system). The editor, code colors and terminals change too, and it is remembered on reopening.
- **New icon:** three overlapping circles, in the app's colors. The agents' start screen uses the same style.

## 1.0.6

- **A fuller explorer:** the tree header has buttons for new file, new folder, refresh, collapse all and open another project. You can also create at the root by clicking an empty space.
- **Name inside the tree:** when creating a file or folder, the name is typed in the tree itself, like in VS Code (Enter creates, Esc cancels).
- **Each project remembers its own:** when you return to a project, the sidebar tab and the files you had open are restored. Switching project closes agents, terminals and files, and asks first if there are unsaved changes.
- **A single Git button:** with a message it does Commit; afterwards it becomes Push, or Pull if the remote has new changes, with a progress animation. Without a remote repository it only offers commit.
- **New branch picker:** VS Code style, with the date and last commit of each branch. It lets you create a branch, create it from another one, and check out detached to go to a branch or commit without creating a branch.
- **Newly created repositories:** Git now works in a repository with no commits at all.
- **Custom tooltips** that show the keyboard shortcut as a key.
- **Cleaner text fields:** no border or focus highlight, looking the same across the whole app.

## 1.0.4

- **Project context:** new section in the sidebar (Ctrl+Shift+K). What you write there is read by the agents you open in that project (Claude Code and OpenCode). It is stored outside the repository.
- **Generate with AI:** a button writes the context from a small summary of the project, using very few tokens. If you switch sections meanwhile, it is cancelled.
- **Recent projects:** when no agents are open you will see the project history to go back to them with one click, open another or remove one with the X.
- **Collapsible sidebar:** when hidden only the icons remain; double-clicking an icon hides or shows it.
- **Files without agents:** if there are no agents, the file you open takes all the space.
- **Version in sight:** the version number appears next to the app name.
- **Centered dialogs** in the window.
