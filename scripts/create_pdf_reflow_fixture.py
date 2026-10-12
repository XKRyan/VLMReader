"""Synthetic PDF: real annotations, flattened marks, images, vector art and rotation."""
from io import BytesIO
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.lib.colors import HexColor
from pypdf import PdfReader, PdfWriter
from pypdf.annotations import Highlight
from pypdf.generic import ArrayObject, FloatObject

root = Path(__file__).resolve().parents[1] / 'tests' / 'fixtures'
figure = root / 'formatting-figure.png'
buf = BytesIO()
c = canvas.Canvas(buf, pagesize=(595, 842))
c.setTitle('PDF reflow features')
c.setFont('Helvetica', 24)
c.drawString(60, 790, 'PDF reflow features')
c.setFont('Helvetica', 16)
c.drawString(60, 730, 'Active recall keeps an idea useful.')
c.drawString(60, 697, 'Annotations can follow a sentence across lines.')
c.drawString(60, 673, 'Reflow keeps their meaning when fonts change.')
x = 60 + stringWidth('A ', 'Helvetica', 16)
w = stringWidth('curious', 'Helvetica', 16)
c.setFillColor(HexColor('#ffff00'))
c.rect(x, 627, w, 18, fill=1, stroke=0)
c.setFillColor(HexColor('#000000'))
c.drawString(60, 630, 'A curious reader asks thoughtful questions.')
c.setFillColor(HexColor('#0066cc'))
c.drawString(60, 595, 'Colored ink remains readable.')
c.setFillColor(HexColor('#000000'))
c.setFont('Courier', 15)
c.drawString(60, 568, 'Careful spacing keeps marks precise.')
c.setFont('Helvetica', 16)
c.drawImage(str(figure), 60, 435, width=380, height=111)
c.drawString(60, 407, 'Figure 1. Read, recall and review.')
c.saveState()
c.translate(300, 285)
c.rotate(25)
c.drawImage(str(figure), 0, 0, width=190, height=55)
c.restoreState()
c.drawString(60, 250, 'A rotated image retains its original appearance.')
for x, label in [(130, 'READ'), (300, 'RECALL')]:
    c.setFillColor(HexColor('#8b7acf'))
    c.circle(x, 140, 42, fill=1, stroke=0)
    c.setFillColor(HexColor('#ffffff'))
    c.setFont('Helvetica', 12)
    c.drawString(x-18, 136, label)
c.setStrokeColor(HexColor('#8b7acf'))
c.setLineWidth(3)
c.line(172, 140, 258, 140)
c.setFillColor(HexColor('#000000'))
c.setFont('Helvetica', 16)
c.drawString(60, 65, 'Figure 2. Vector artwork also stays visible.')
c.showPage()
c.setFont('Helvetica', 22)
c.drawString(60, 780, 'A rotated page')
c.setFont('Helvetica', 16)
c.drawString(60, 730, 'Rotation must not lose this highlight or picture.')
c.drawImage(str(figure), 60, 495, width=400, height=117)
c.showPage()
# An image-only page must stay visible instead of becoming an empty text page.
c.drawImage(str(figure), 0, 0, width=595, height=842)
c.showPage()
c.setFont('Helvetica', 18)
c.drawString(60, 780, 'Continuous reading')
c.setFont('Helvetica', 14)
for row in range(27):
    c.drawString(60, 740-row*23, f'Line {row+1}. Retrieval practice supports durable learning.')
c.save()

writer = PdfWriter()
writer.append(PdfReader(buf))

def quad(start, y, width, height=18):
    return [start, y+height*.8, start+width, y+height*.8,
            start, y-height*.2, start+width, y-height*.2]

def highlight(page, quads, color):
    xs = quads[0::2]
    ys = quads[1::2]
    writer.add_annotation(page, Highlight(
        rect=(min(xs), min(ys), max(xs), max(ys)),
        quad_points=ArrayObject([FloatObject(v) for v in quads]),
        highlight_color=color))

highlight(0, quad(60+stringWidth('Active ', 'Helvetica', 16), 730,
                  stringWidth('recall', 'Helvetica', 16)), 'ffff00')
highlight(0, quad(60+stringWidth('Annotations can follow a ', 'Helvetica', 16), 697,
                  stringWidth('sentence', 'Helvetica', 16))
          + quad(60, 673, stringWidth('Reflow keeps', 'Helvetica', 16)), '00ffff')
highlight(1, quad(60, 730, stringWidth('Rotation', 'Helvetica', 16)), 'ffff00')
highlight(0, quad(60+stringWidth('Careful ', 'Courier', 15), 568,
                  stringWidth('spacing', 'Courier', 15)), 'ffff00')
writer.pages[1].rotate(90)
target = root / 'Reflow.pdf'
with target.open('wb') as f:
    writer.write(f)
print('Created Reflow.pdf: four synthetic pages, four annotations and embedded artwork.')
