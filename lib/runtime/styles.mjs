export const styles = `
:host{display:block;container-type:inline-size;color-scheme:var(--iui-color-scheme,light);color:var(--iui-text,#1f2a37);font:15px/1.55 var(--iui-font,system-ui,-apple-system,'Segoe UI',sans-serif);--_accent:var(--iui-accent,#2f6f62);--_muted:var(--iui-muted,#5f6b7a);--_border:var(--iui-border,#d9e0e6);--_surface:var(--iui-surface,#fff);--_subtle:var(--iui-subtle,#f4f7f8);--_danger:var(--iui-danger,#b42318);--_success:var(--iui-success,#1d7a46);--_warning:var(--iui-warning,#9a5b00);--_radius:var(--iui-radius,8px)}
*{box-sizing:border-box}[hidden]{display:none!important}
.root{display:block}
.stack{display:flex;flex-direction:column}.stack.horizontal{flex-direction:row;align-items:center}.stack.wrap{flex-wrap:wrap}
.gap-none{gap:0}.gap-small{gap:6px}.gap-medium{gap:12px}.gap-large{gap:24px}
.align-start{align-items:flex-start}.align-center{align-items:center}.align-end{align-items:flex-end}.align-stretch{align-items:stretch}.stack.horizontal.align-stretch{align-items:stretch}
.grid{display:grid;grid-template-columns:repeat(var(--columns,2),minmax(0,1fr))}
.card{background:var(--_surface);border:1px solid var(--_border);border-radius:var(--_radius);padding:16px;display:flex;flex-direction:column;gap:12px}
.card>.card-header>h3{margin:0;font-size:17px;line-height:1.35}.card>.card-header>p{margin:4px 0 0;color:var(--_muted)}
hr{border:0;border-top:1px solid var(--_border);margin:4px 0;width:100%}
h2,h3,h4{margin:0;line-height:1.3}h2{font-size:22px}h3{font-size:18px}h4{font-size:16px}
p{margin:0}.caption{font-size:13px;color:var(--_muted)}
pre{margin:0;padding:10px 12px;background:var(--_subtle);border-radius:6px;overflow:auto;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap}
.tone-muted{color:var(--_muted)}.tone-success{color:var(--_success)}.tone-warning{color:var(--_warning)}.tone-danger{color:var(--_danger)}
figure{margin:0;display:flex;flex-direction:column;gap:6px}figcaption{font-size:13px;color:var(--_muted)}
img{max-width:100%;height:auto;border-radius:6px;display:block}
a{color:var(--_accent);text-underline-offset:2px}
.fallback{padding:12px;border:1px dashed var(--_border);border-radius:6px;color:var(--_muted);font-size:14px}
.field{display:flex;flex-direction:column;gap:6px;border:0;margin:0;padding:0;min-width:0}
.field>label,.field>legend{font-weight:600;font-size:14px;padding:0}
.description{font-size:13px;color:var(--_muted)}
.error{font-size:13px;color:var(--_danger)}
input,textarea,select,button{font:inherit;color:inherit}
input:not([type=checkbox]):not([type=radio]):not([type=range]),textarea,select{width:100%;padding:9px 10px;border:1px solid var(--_border);border-radius:6px;background:var(--_surface)}
textarea{min-height:96px;resize:vertical}
[aria-invalid=true]{border-color:var(--_danger)!important}
.options{display:flex;flex-direction:column;gap:6px}
.option{display:flex;gap:10px;align-items:flex-start;cursor:pointer}
.option small{display:block;font-size:12px;color:var(--_muted)}
.options.buttons{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.options.buttons .option{border:1px solid var(--_border);border-radius:var(--_radius);padding:10px 12px;background:var(--_surface)}
.options.buttons .option:has(input:checked){border-color:var(--_accent);background:color-mix(in srgb,var(--_accent) 8%,var(--_surface));box-shadow:0 0 0 1px var(--_accent)}
.options.buttons .option:has(input:focus-visible){outline:3px solid color-mix(in srgb,var(--_accent) 45%,transparent);outline-offset:2px}
.options.buttons input{position:absolute;opacity:0;width:1px;height:1px}
.toggle{display:flex;gap:10px;align-items:center;cursor:pointer;font-weight:600;font-size:14px}
.toggle input{width:36px;height:20px;appearance:none;border-radius:10px;background:var(--_border);position:relative;cursor:pointer;flex-shrink:0;margin:0}
.toggle input::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s}
.toggle input:checked{background:var(--_accent)}.toggle input:checked::after{left:18px}
.slider{display:flex;gap:12px;align-items:center}.slider input{flex:1;accent-color:var(--_accent)}.slider output{min-width:3ch;text-align:right;font-variant-numeric:tabular-nums}
form{display:flex;flex-direction:column;gap:14px}
button{cursor:pointer;border-radius:6px;padding:8px 14px;border:1px solid var(--_border);background:var(--_surface)}
button.primary{background:var(--_accent);border-color:var(--_accent);color:#fff}
button.danger{background:var(--_surface);border-color:var(--_danger);color:var(--_danger)}
button:disabled{opacity:.6;cursor:default}
:focus-visible{outline:3px solid color-mix(in srgb,var(--_accent) 45%,transparent);outline-offset:2px}
.status{font-size:14px;min-height:0}.status:empty{display:none}.status.failed{color:var(--_danger)}.status.succeeded{color:var(--_success)}.status.invalid{color:var(--_danger)}
[role=tablist]{display:flex;gap:2px;border-bottom:1px solid var(--_border);overflow-x:auto}
[role=tab]{border:0;border-bottom:2px solid transparent;border-radius:0;background:none;padding:8px 12px;color:var(--_muted);white-space:nowrap}
[role=tab][aria-selected=true]{border-bottom-color:var(--_accent);color:inherit;font-weight:600}
[role=tabpanel]{padding-top:12px}
.disclosure>button{background:none;border:0;padding:4px 0;font-weight:600;display:flex;gap:8px;align-items:center}
.disclosure>button::before{content:'▸';display:inline-block;transition:transform .15s}.disclosure>button[aria-expanded=true]::before{transform:rotate(90deg)}
.disclosure>div{padding:8px 0 0 18px;display:flex;flex-direction:column;gap:12px}
.table-wrap{overflow:auto;border:1px solid var(--_border);border-radius:var(--_radius)}
table{border-collapse:collapse;width:100%;font-size:14px}caption{text-align:left;padding:8px 12px;font-weight:600}
th,td{padding:8px 12px;border-bottom:1px solid var(--_border);text-align:left;vertical-align:top}tr:last-child td{border-bottom:0}
th{background:var(--_subtle);font-weight:600}td.number,th.number{text-align:right;font-variant-numeric:tabular-nums}
th button{all:unset;cursor:pointer;display:inline-flex;gap:4px}th button:focus-visible{outline:3px solid color-mix(in srgb,var(--_accent) 45%,transparent)}
th[aria-sort=ascending] button::after{content:'▲';font-size:10px}th[aria-sort=descending] button::after{content:'▼';font-size:10px}
.preview iframe{width:100%;border:1px solid var(--_border);border-radius:var(--_radius);background:var(--_subtle)}
.unavailable{padding:12px;border:1px solid var(--_border);border-radius:6px;color:var(--_muted);background:var(--_subtle)}
@container (max-width:560px){.grid{grid-template-columns:1fr}.stack.horizontal:not(.wrap){flex-wrap:wrap}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;
