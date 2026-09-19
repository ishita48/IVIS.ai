"""
LENS demo: two-stage COMPOUND gear train -> one printable STL.

Why compound rather than a plain row of gears: a plain train has one idea in
it (small gear spins faster) and a novice gets it in ten seconds. A compound
train has two stages whose ratios MULTIPLY, and almost everyone adds them
instead. That is a real, specific, wrong prediction — which is the only kind
this product can teach against.

  stage 1   A(30T) drives B1(10T)      -> B spins 3x
  stage 2   B2(30T) drives C(10T)      -> C spins 3x B
  overall                              -> C spins NINE times per crank turn

Typical guesses are 3x or 6x. It is 9x, and with an index pip on C the
difference is obvious at a glance — it blurs.

Second trap: two meshes means two direction reversals, so the output turns the
SAME way as the crank. People reliably expect it to turn backwards.

FIVE PARTS, ONE PRINT, laid flat, no supports:
  1  base plate with three pegs
  2  gear A   (30T) + crank knob + index pip
  3  gear B   COMPOUND: 30T and 10T fused on one bore  <- the interesting part
  4  gear C   (10T) + index pip
  5  spacer ring, goes under A so it meets B's upper gear

Assembly: spacer on peg 1 then A, B on peg 2, C on peg 3. Nothing glued.
Bores are 0.8mm oversize so everything spins.
"""
import math, struct

M = 1.5
PA = math.radians(20)
PLATE = (101.0, 56.0, 3.0)
PEG_D, PEG_H = 5.0, 9.0
GEAR_T, BORE_D = 3.0, 5.8
KNOB_D, KNOB_H = 9.0, 7.0
PIP_D, PIP_H = 5.0, 2.0
SPACER_OD = 14.0
SEG = 16
ASSEMBLED = False

tris=[]
def quad(a,b,c,d): tris.append((a,b,c)); tris.append((a,c,d))

def ring_prism(ring,z0,z1,inner=None):
    n=len(ring)
    for i in range(n):
        j=(i+1)%n; p,q=ring[i],ring[j]
        quad((p[0],p[1],z0),(q[0],q[1],z0),(q[0],q[1],z1),(p[0],p[1],z1))
        if inner is None:
            o=ring[0]
            if i not in (0,n-1):
                tris.append(((o[0],o[1],z1),(p[0],p[1],z1),(q[0],q[1],z1)))
                tris.append(((o[0],o[1],z0),(q[0],q[1],z0),(p[0],p[1],z0)))
        else:
            ip,iq=inner[i],inner[j]
            quad((p[0],p[1],z1),(q[0],q[1],z1),(iq[0],iq[1],z1),(ip[0],ip[1],z1))
            quad((ip[0],ip[1],z0),(iq[0],iq[1],z0),(q[0],q[1],z0),(p[0],p[1],z0))
            quad((iq[0],iq[1],z0),(ip[0],ip[1],z0),(ip[0],ip[1],z1),(iq[0],iq[1],z1))

def inv(rb,r):
    if r<=rb: return 0.0
    a=math.sqrt(r*r-rb*rb)/rb
    return a-math.atan(a)

def gear_ring(z,cx,cy,rot=0.0):
    rp=M*z/2.0; rb=rp*math.cos(PA); ra=rp+M
    rf=max(rp-1.25*M, BORE_D/2+2.0)
    half=math.pi/(2*z); off=inv(rb,rp); pts=[]
    for k in range(z):
        base=2*math.pi*k/z+rot
        fl=[]
        for i in range(SEG+1):
            r=max(rb,rf)+(ra-max(rb,rf))*i/SEG
            fl.append((r,inv(rb,r)-off))
        pts.append((rf,base-half*1.55))
        for r,th in fl: pts.append((r,base-half+th))
        for r,th in reversed(fl): pts.append((r,base+half-th))
        pts.append((rf,base+half*1.55))
    return [(cx+r*math.cos(t),cy+r*math.sin(t)) for r,t in pts]

def circ(cx,cy,rad,like=None,seg=56):
    if like is None:
        return [(cx+rad*math.cos(2*math.pi*i/seg),cy+rad*math.sin(2*math.pi*i/seg)) for i in range(seg)]
    return [(cx+rad*math.cos(math.atan2(y-cy,x-cx)),cy+rad*math.sin(math.atan2(y-cy,x-cx))) for x,y in like]

def spoke(cx,cy,ang,r0,r1,w,z0,z1):
    ca,sa=math.cos(ang),math.sin(ang); nx,ny=-sa,ca
    pts=[(cx+ca*r0+nx*w/2, cy+sa*r0+ny*w/2),
         (cx+ca*r1+nx*w/2, cy+sa*r1+ny*w/2),
         (cx+ca*r1-nx*w/2, cy+sa*r1-ny*w/2),
         (cx+ca*r0-nx*w/2, cy+sa*r0-ny*w/2)]
    ring_prism(pts,z0,z1)

def gear_body(z,cx,cy,z0,rot=0.0,spokes=0):
    r=gear_ring(z,cx,cy,rot)
    if not spokes:
        ring_prism(r,z0,z0+GEAR_T,inner=circ(cx,cy,BORE_D/2,like=r))
        return
    rp=M*z/2.0
    rf=max(rp-1.25*M, BORE_D/2+2.0)
    r_rim=rf-3.0
    r_hub=BORE_D/2+3.0
    ring_prism(r,z0,z0+GEAR_T,inner=circ(cx,cy,r_rim,like=r))          # toothed rim
    ring_prism(circ(cx,cy,r_hub),z0,z0+GEAR_T,inner=circ(cx,cy,BORE_D/2,seg=56))  # hub
    for i in range(spokes):
        spoke(cx,cy,2*math.pi*i/spokes+rot, r_hub-0.6, r_rim+0.6, 4.0, z0, z0+GEAR_T)

def pip(cx,cy,rad_at,ztop):
    ring_prism(circ(cx+rad_at,cy,PIP_D/2),ztop,ztop+PIP_H)

def add_box(x,y,w,d,h): ring_prism([(x,y),(x+w,y),(x+w,y+d),(x,y+d)],0.0,h)

CD=M*(30+10)/2.0                     # 50mm between every peg
BASE=PLATE[2]
xs=[28.0,28.0+CD,28.0+2*CD]
cy=PLATE[1]/2

SPINE_W, FOOT_W, FOOT_D = 12.0, 6.0, 40.0
add_box(xs[0]-10, cy-SPINE_W/2, (xs[2]-xs[0])+20, SPINE_W, BASE)
add_box(xs[0]-10, cy-FOOT_D/2, FOOT_W, FOOT_D, BASE)
add_box(xs[2]+10-FOOT_W, cy-FOOT_D/2, FOOT_W, FOOT_D, BASE)
for x in xs: ring_prism(circ(x,cy,PEG_D/2),BASE,BASE+PEG_H)

if ASSEMBLED:
    ring_prism(circ(xs[0],cy,SPACER_OD/2),BASE,BASE+GEAR_T,inner=circ(xs[0],cy,BORE_D/2,seg=56))
    gear_body(30,xs[0],cy,BASE+GEAR_T,spokes=5); pip(xs[0],cy,M*30/2*0.62,BASE+2*GEAR_T)
    ring_prism(circ(xs[0]-M*30/2*0.66,cy,KNOB_D/2),BASE+2*GEAR_T,BASE+2*GEAR_T+KNOB_H)
    gear_body(30,xs[1],cy,BASE,spokes=5); gear_body(10,xs[1],cy,BASE+GEAR_T,rot=math.pi/10)
    pip(xs[1],cy,M*30/2*0.62,BASE+GEAR_T)
    gear_body(10,xs[2],cy,BASE,rot=math.pi/10); pip(xs[2],cy,M*10/2*0.55,BASE+GEAR_T)
else:
    rA=M*32/2; rC=M*12/2
    gy=PLATE[1]+10+rA
    gear_body(30,rA+4,gy,0.0,spokes=5); pip(rA+4,gy,M*30/2*0.62,GEAR_T)
    ring_prism(circ(rA+4-M*30/2*0.66,gy,KNOB_D/2),GEAR_T,GEAR_T+KNOB_H)
    bx=rA+4+2*rA+8
    gear_body(30,bx,gy,0.0,spokes=5); gear_body(10,bx,gy,GEAR_T,rot=math.pi/10)
    pip(bx,gy,M*30/2*0.62,GEAR_T)
    cx2=bx+rA+rC+8
    gear_body(10,cx2,gy,0.0,rot=math.pi/10); pip(cx2,gy,M*10/2*0.55,GEAR_T)
    sx=cx2; sy=gy-rC-SPACER_OD/2-7
    ring_prism(circ(sx,sy,SPACER_OD/2),0.0,GEAR_T,inner=circ(sx,sy,BORE_D/2,seg=56))

with open("lens-gear-train.stl","wb") as f:
    f.write(b"LENS compound gear train - HackMIT 2026".ljust(80,b"\0"))
    f.write(struct.pack("<I",len(tris)))
    for a,b,c in tris:
        u=(b[0]-a[0],b[1]-a[1],b[2]-a[2]); v=(c[0]-a[0],c[1]-a[1],c[2]-a[2])
        nx,ny,nz=u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]
        L=math.sqrt(nx*nx+ny*ny+nz*nz) or 1.0
        f.write(struct.pack("<3f",nx/L,ny/L,nz/L))
        for p in (a,b,c): f.write(struct.pack("<3f",*p))
        f.write(struct.pack("<H",0))

X=[p[0] for t in tris for p in t]; Y=[p[1] for t in tris for p in t]; Z=[p[2] for t in tris for p in t]
vol=sum((a[0]*(b[1]*c[2]-c[1]*b[2])-a[1]*(b[0]*c[2]-c[0]*b[2])+a[2]*(b[0]*c[1]-c[0]*b[1]))/6 for a,b,c in tris)
print(f"bed footprint : {max(X)-min(X):.0f} x {max(Y)-min(Y):.0f} x {max(Z)-min(Z):.0f} mm   (bed is 256 x 256 x 256)")
print(f"big gear OD   : {M*32:.0f} mm    small gear OD: {M*12:.0f} mm")
print(f"ratio         : 9:1  (3 x 3, not 3 + 3)")
print(f"solid volume  : {abs(vol)/1000:.1f} cm3   ~{abs(vol)/1000*0.35*1.24:.0f} g PLA at 15%")
