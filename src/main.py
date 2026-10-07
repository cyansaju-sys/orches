import flet as ft
from flet import Container, Row
from widgets.layout.tabar import TabBar
from widgets.layout.workspace import Workspace
from widgets.layout.titlebar import TitleBar

def main(page: ft.Page):
  page.title = "IA orches"
  page.bgcolor = "#07080C"
  page.padding = 2
  page.spacing = 0
  page.window.title_bar_hidden = True
  page.window.title_bar_buttons_hidden = True

  workspace = Workspace(page)

  page.add(
    TitleBar(page, workspace.toggle_terminal),
    Container(
      padding=2,
      expand=True,
      content=Row(
        expand=True,
        vertical_alignment=ft.CrossAxisAlignment.STRETCH,
        controls=[
          TabBar(page, workspace.open_agent),
          workspace,
        ],
        spacing=0,
      ),
    ),
  )
  page.overlay.append(workspace.input_widget)


if __name__ == "__main__":
  ft.run(main)