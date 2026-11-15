import json,hashlib
from pathlib import Path
from fontTools.ttLib import TTFont
root=Path(__file__).resolve().parent/'font-audit'
fonts=[]
for p in sorted(root.glob('*.woff2')):
    font=TTFont(p)
    records=[]
    for n in font['name'].names:
        records.append({'nameID':n.nameID,'platformID':n.platformID,'encodingID':n.platEncID,'languageID':n.langID,'text':n.toUnicode()})
    assert records,'No name table'
    cmap=font.getBestCmap()
    fonts.append({'file':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'names':records,'glyphCount':font['maxp'].numGlyphs,'cmapCodepointCount':len(cmap),'containsDiameterSign':0x2300 in cmap,'containsPlusMinus':0xB1 in cmap})
result={'scope':'Independent parsing of actual packaged WOFF2 name/cmap tables; factual metadata only, not OFL reserved-name legal approval','fonts':fonts}
(root/'name-tables.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False,indent=2))
