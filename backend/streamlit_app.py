import streamlit as st

st.set_page_config(page_title="Personal banker", page_icon=":material/account_balance:", layout="wide")

page = st.navigation(
    [
        st.Page("app_pages/statements.py", title="Statements", icon=":material/account_balance:", default=True),
        st.Page("app_pages/document_viewer.py", title="Document viewer", icon=":material/document_scanner:"),
        st.Page("app_pages/categorize.py", title="Budget categories", icon=":material/category:"),
    ]
)
page.run()
