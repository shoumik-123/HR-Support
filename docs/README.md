# Documents

Generated reading material that is not source code.

| File | What it is |
|---|---|
| `Veyra-Talent-Test-Golpo.pdf` | A story-driven end-to-end test script in Bengali: one hire from requisition to onboarding, walked through as HR and again as the candidate, with a tick box for every invariant worth protecting. 21 pages. |
| `test-golpo.html` | The source of that PDF. |

## Rebuilding the PDF

Chrome renders Bengali conjuncts correctly; ReportLab does not, which is why this
goes through the browser rather than a Python PDF library.

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu `
  --no-pdf-header-footer --print-to-pdf="docs\Veyra-Talent-Test-Golpo.pdf" `
  "file:///C:/Users/user/Downloads/Project/HR_Support/docs/test-golpo.html"
```

The page uses the Windows font Nirmala UI. On a machine without it, add a Bengali
webfont to the stylesheet first or the text falls back to boxes.
