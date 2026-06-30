# -*- coding: utf-8 -*-
"""临时：给生成的看板注入 focus，让趋势下拉默认展开以便截图验证。跑完即删。"""
import sys
sys.stdout.reconfigure(encoding="utf-8")
src = r"C:\Users\duansb\Desktop\小红书营销数据\demo_全链路投放看板.html"
dst = r"C:\Users\duansb\Desktop\小红书营销数据\_ttest.html"
html = open(src, encoding="utf-8").read()
inj = ('<script>window.addEventListener("load",function(){setTimeout(function(){'
       'var i=document.getElementById("trendInput");'
       'if(i){i.focus();i.dispatchEvent(new Event("focus"));}},600);});</script>')
html = html.replace("</body>", inj + "</body>")
open(dst, "w", encoding="utf-8").write(html)
print("injected ->", dst)
