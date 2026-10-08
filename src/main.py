import flet as ft
from flet import Container, Row
from orches.ui.layout.sidebar import Sidebar
from orches.ui.layout.workspace import Workspace
from orches.ui.layout.titlebar import TitleBar

def main(page: ft.Page):
  page.title = "IA orches"
  page.bgcolor = "#07080C"
  page.padding = 4
  page.spacing = 0
  page.window.title_bar_hidden = True
  page.window.title_bar_buttons_hidden = True

  workspace = Workspace(page)
  sidebar = Sidebar(page, workspace.open_agent, workspace.open_document)
  workspace.bind("tab", sidebar.select_tab)                    # atajos de teclado que tocan la barra lateral
  workspace.bind("toggle_sidebar", sidebar.toggle_sidebar)
  workspace.bind("files_key", sidebar.files_key)
  workspace.bind("files_blur", sidebar.files_blur)

  page.add(
    TitleBar(page, workspace.toggle_terminal),
    Container(
      padding=2,
      expand=True,
      content=Row(
        expand=True,
        vertical_alignment=ft.CrossAxisAlignment.STRETCH,
        controls=[
          sidebar,
          workspace,
        ],
        spacing=0,
      ),
    ),
  )
  page.overlay.append(workspace.input_widget)


if __name__ == "__main__":
  ft.run(main)