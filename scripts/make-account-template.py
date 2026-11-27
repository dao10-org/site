# 生成《事项经费记账模板》 xlsx（Excel / WPS 都能打开）
# 用法：python scripts/make-account-template.py
# 输出：src/assets/files/shixiang-jizhang-moban.xlsx
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.datavalidation import DataValidation

OUT = Path(__file__).resolve().parent.parent / "src/assets/files/shixiang-jizhang-moban.xlsx"

GREEN = "3B7A4F"
HEAD = PatternFill("solid", fgColor=GREEN)
HFONT = Font(bold=True, color="FFFFFF")
EXAMPLE = Font(color="888888", italic=True)
thin = Side(style="thin", color="BBBBBB")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
WRAP = Alignment(wrap_text=True, vertical="top")
ROWS = 300  # 预留行数

wb = Workbook()


def header(ws, cols):
    for i, (name, width) in enumerate(cols, 1):
        c = ws.cell(row=1, column=i, value=name)
        c.fill, c.font, c.border = HEAD, HFONT, BOX
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.column_dimensions[c.column_letter].width = width
    ws.row_dimensions[1].height = 32
    ws.freeze_panes = "A2"


def example(ws, row, values):
    for i, v in enumerate(values, 1):
        c = ws.cell(row=row, column=i, value=v)
        c.font = EXAMPLE


# ---------- 1. 使用说明 ----------
ws = wb.active
ws.title = "使用说明"
ws.column_dimensions["A"].width = 100
lines = [
    ("事项经费记账模板", True),
    ("共道文明 推荐 · 不强制 · 可自由修改和转发（CC BY-SA 4.0）", False),
    ("", False),
    ("一、四张表", True),
    ("1. 项目登记：每一件事（印一批资料、办一次交流会、建一个网站……）先在这里登记一行，给一个编号，写明预算和行政费比例。", False),
    ("2. 收支流水：所有收入和支出都记在这一张表里，每一行写上属于哪个项目编号。团体日常开销用编号 G（通用账）。", False),
    ("3. 项目汇总：自动计算，不用手填。每个项目收了多少、花了多少、提了多少行政费、还剩多少。", False),
    ("4. 对账记录：每月一次，账面余额和实际账户（现金、银行、微信、支付宝等）对一下，两个人签名。", False),
    ("", False),
    ("二、几条规则", True),
    ("1. 一事一账：每个项目的钱单独记，不和别的项目混用。", False),
    ("2. 行政费事先声明：立项时写明比例（0%～20%），以后只能降，不能升。", False),
    ("3. 行政费按实际到账的收入提取：提取时记一行“行政费提取”，从项目转入通用账 G，金额不超过 收入 × 比例。", False),
    ("4. 只追加，不删改：记错了不要删，也不要改原来那一行；另记一行同样类型、金额写负数的“冲正”行，在最后一栏写明冲正哪一笔、为什么，再记一行正确的。", False),
    ("5. 每一笔都有凭证：收据、发票、转账截图、照片，编号写在“凭证编号”一栏，凭证另外按编号保存。", False),
    ("6. 收钱的人和记账的人，最好不是同一个人；每月至少两个人一起对账。", False),
    ("7. 结项要余额为零：剩下的钱按立项时写好的办法处理（退还 / 转入下一个项目 / 转入通用账），也要记一行。", False),
    ("", False),
    ("三、金额怎么写", True),
    ("收入、支出都写正数，在“收支类型”里选类型，汇总表会自动分开计算。只有冲正行写负数。", False),
    ("不同币种请分开记（可以复制一份文件，或增加一列“币种”），不要在同一列里混写人民币和美元。", False),
    ("", False),
    ("四、隐私", True),
    ("“对方”一栏可以只写编号或“匿名”。对外公开时，删去捐款人姓名和联系方式，只公开编号、日期、金额、用途。", False),
    ("", False),
    ("灰色斜体的几行是示例，用之前请删掉。", False),
    ("说明文章：dao10.org/zh/library/  （《账目清楚，道义才立得住》等三篇）", False),
]
for i, (t, bold) in enumerate(lines, 1):
    c = ws.cell(row=i, column=1, value=t)
    c.alignment = WRAP
    if bold:
        c.font = Font(bold=True, size=14 if i == 1 else 12, color=GREEN)

# ---------- 2. 项目登记 ----------
wp = wb.create_sheet("项目登记")
header(wp, [
    ("项目编号", 10), ("项目名称", 24), ("目的（做什么、为什么）", 34), ("预算", 10),
    ("行政费比例%（0～20）", 12), ("开始日期", 12), ("计划完成", 12), ("负责人", 10),
    ("记账人", 10), ("结余怎么处理", 22), ("状态", 10), ("结项日期", 12), ("备注", 24),
])
example(wp, 2, ["G", "通用账（团体日常）", "房租、水电、通讯、手续费、行政费提取后的去向", "", "", "2026-12-01", "", "甲", "乙", "长期账户", "进行中", "", "示例，请删除"])
example(wp, 3, ["P001", "印刷《共生之道》100 册", "给成员和来访者免费赠阅", 3000, 10, "2026-12-01", "2027-01-31", "甲", "乙", "转入通用账 G", "进行中", "", "示例，请删除"])
dv_rate = DataValidation(type="decimal", operator="between", formula1="0", formula2="20",
                         error="行政费比例只能在 0～20 之间", showErrorMessage=True)
wp.add_data_validation(dv_rate)
dv_rate.add(f"E2:E{ROWS}")
dv_state = DataValidation(type="list", formula1='"筹备中,进行中,对账中,已完结,已中止"', allow_blank=True)
wp.add_data_validation(dv_state)
dv_state.add(f"K2:K{ROWS}")

# ---------- 3. 收支流水 ----------
wl = wb.create_sheet("收支流水")
header(wl, [
    ("流水号", 9), ("日期", 12), ("项目编号", 10), ("收支类型", 14), ("金额", 11),
    ("对方（可写编号或匿名）", 18), ("摘要（用途或来源）", 34), ("支付方式", 11),
    ("凭证编号", 11), ("记账人", 9), ("核对人", 9), ("冲正哪一笔/理由", 22),
])
TYPES = "收入,支出,行政费提取,行政费转入,结余转出,结余转入"
dv_type = DataValidation(type="list", formula1=f'"{TYPES}"', allow_blank=True)
wl.add_data_validation(dv_type)
dv_type.add(f"D2:D{ROWS}")
ex = [
    [1, "2026-12-03", "P001", "收入", 500, "D001", "捐赠：印刷费", "转账", "R001", "乙", "丙", ""],
    [2, "2026-12-05", "P001", "收入", 2500, "匿名", "捐赠：印刷费", "现金", "R002", "乙", "丙", ""],
    [3, "2026-12-20", "P001", "支出", 2600, "某印刷厂", "印刷 100 册", "转账", "F001", "乙", "丙", ""],
    [4, "2026-12-20", "P001", "行政费提取", 300, "", "按收入 3000 × 10%", "内部", "", "乙", "丙", ""],
    [5, "2026-12-20", "G", "行政费转入", 300, "", "来自 P001", "内部", "", "乙", "丙", ""],
    [6, "2026-12-21", "P001", "支出", 120, "快递公司", "寄送", "转账", "F002", "乙", "丙", ""],
    [7, "2026-12-22", "P001", "支出", -120, "快递公司", "第 6 笔金额记错", "", "F002", "乙", "丙", "冲正第 6 笔：实为 100"],
    [8, "2026-12-22", "P001", "支出", 100, "快递公司", "寄送（更正后）", "转账", "F002", "乙", "丙", "替代第 6 笔"],
]
for r, row in enumerate(ex, 2):
    example(wl, r, row)

# ---------- 4. 项目汇总（全公式） ----------
wsum = wb.create_sheet("项目汇总")
header(wsum, [
    ("项目编号", 10), ("项目名称", 24), ("行政费比例%", 10), ("收入合计", 11),
    ("支出合计", 11), ("行政费已提取", 12), ("行政费上限", 11), ("是否超限", 9),
    ("结余转出", 10), ("其他转入", 10), ("当前余额", 11), ("状态", 10),
])
F = "收支流水!"
for r in range(2, 102):
    a = f"项目登记!A{r}"
    wsum[f"A{r}"] = f'=IF({a}="","",{a})'
    wsum[f"B{r}"] = f'=IF(A{r}="","",项目登记!B{r})'
    wsum[f"C{r}"] = f'=IF(A{r}="","",N(项目登记!E{r}))'
    def s(kind):
        return f'SUMIFS({F}$E:$E,{F}$C:$C,$A{r},{F}$D:$D,"{kind}")'
    wsum[f"D{r}"] = f'=IF(A{r}="","",{s("收入")})'
    wsum[f"E{r}"] = f'=IF(A{r}="","",{s("支出")})'
    wsum[f"F{r}"] = f'=IF(A{r}="","",{s("行政费提取")})'
    wsum[f"G{r}"] = f'=IF(A{r}="","",ROUND(D{r}*C{r}/100,2))'
    wsum[f"H{r}"] = f'=IF(A{r}="","",IF(F{r}>G{r}+0.005,"超限",""))'
    wsum[f"I{r}"] = f'=IF(A{r}="","",{s("结余转出")})'
    wsum[f"J{r}"] = f'=IF(A{r}="","",{s("行政费转入")}+{s("结余转入")})'
    wsum[f"K{r}"] = f'=IF(A{r}="","",D{r}+J{r}-E{r}-F{r}-I{r})'
    wsum[f"L{r}"] = f'=IF(A{r}="","",项目登记!K{r})'
    for col in "DEFGIJK":
        wsum[f"{col}{r}"].number_format = "#,##0.00"
note = wsum.cell(row=1, column=14, value="说明：本表全是公式，不要手填。“当前余额”= 收入 + 转入 − 支出 − 行政费提取 − 结余转出（冲正行是负数，已自动算进去）。")
note.alignment = WRAP
wsum.column_dimensions["N"].width = 40

# ---------- 5. 对账记录 ----------
wr = wb.create_sheet("对账记录")
header(wr, [
    ("对账日期", 12), ("账户（现金/银行/微信/支付宝…）", 26), ("实际余额", 12),
    ("账面余额（所有项目当前余额之和）", 18), ("差额", 10), ("差额原因", 30),
    ("对账人 1", 10), ("对账人 2", 10),
])
for r in range(2, 202):
    wr[f"D{r}"] = f'=IF(A{r}="","",SUM(项目汇总!K:K))'
    wr[f"E{r}"] = f'=IF(A{r}="","",C{r}-D{r})'
example(wr, 2, ["2026-12-31", "全部账户合计", 300, None, None, "", "乙", "丙"])
wr["D2"] = '=IF(A2="","",SUM(项目汇总!K:K))'
wr["E2"] = '=IF(A2="","",C2-D2)'

OUT.parent.mkdir(parents=True, exist_ok=True)
wb.save(OUT)
print("wrote", OUT)
