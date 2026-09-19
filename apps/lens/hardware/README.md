# LENS demo object — compound gear train

A printable teaching object for the camera demo. Two stages whose ratios
multiply: A(30T) drives B1(10T), B2(30T) drives C(10T), so the output turns
**nine** times per crank turn. Almost everyone predicts 3x or 6x — they add the
stages instead of multiplying them. Two meshes also means two reversals, so the
output turns the *same* way as the crank, which people also get wrong.

That is the point: a specific, confident, wrong prediction that LENS can point
at without stating the fix.

## Regenerating

    python3 gear-demo.py      # -> lens-gear-train.stl  (print layout, flat)
    python3 preview.py        # -> preview-*.png

Set `ASSEMBLED = True` in gear-demo.py to emit the assembled form instead —
useful for renders, not for printing.

## Printing

Five loose parts, one job, no supports. Bores are 0.8mm oversize on purpose:
a press-fit gear that will not spin is a dead demo.

Constraint that drove the design: the HackMIT print desk caps jobs at **30
minutes**. The first version was 2h08m. Fixes, in order of impact:

  - spokes instead of solid gear webs
  - a spine with two feet instead of a solid base plate — flat thin slabs are
    nearly 100% solid after top/bottom shells, whatever the infill is set to
  - lower overall height, since layer count drives time as much as volume

Slice at **0.28mm layer height, 10% infill, 2 walls**. At 0.20mm defaults it
will not fit the cap.

## Assembly

Spacer onto peg 1, then gear A. Compound gear B onto peg 2. Gear C onto peg 3.
The spacer lifts A so it meets B's upper gear.
