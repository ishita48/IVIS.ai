import struct, math, zlib, sys

def load(p):
    t=[]
    with open(p,"rb") as f:
        f.read(80); n=struct.unpack("<I",f.read(4))[0]
        for _ in range(n):
            f.read(12); v=[struct.unpack("<3f",f.read(12)) for _ in range(3)]; f.read(2); t.append(v)
    return t

W,H=1000,780
def render(tris,path,yaw,pitch):
    ya,pa=math.radians(yaw),math.radians(pitch)
    def proj(p):
        x,y,z=p
        x1= x*math.cos(ya)-y*math.sin(ya)
        y1= x*math.sin(ya)+y*math.cos(ya)
        y2= y1*math.cos(pa)-z*math.sin(pa)      # depth into screen
        z2= y1*math.sin(pa)+z*math.cos(pa)      # up on screen
        return (x1,z2,y2)
    pts=[proj(p) for t in tris for p in t]
    xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
    mnx,mxx,mny,mxy=min(xs),max(xs),min(ys),max(ys)
    sc=min((W-70)/(mxx-mnx),(H-70)/(mxy-mny))
    px=[[(11,18,32)]*W for _ in range(H)]; zb=[[1e9]*W for _ in range(H)]
    for t in tris:
        pr=[proj(p) for p in t]
        s=[((p[0]-mnx)*sc+35, H-((p[1]-mny)*sc+35), p[2]) for p in pr]
        a,b,c=s
        u=(b[0]-a[0],b[1]-a[1],b[2]-a[2]); v=(c[0]-a[0],c[1]-a[1],c[2]-a[2])
        nx,ny,nz=u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]
        L=math.sqrt(nx*nx+ny*ny+nz*nz) or 1
        sh=max(0.25,min(1.0,abs(nz/L)*0.55+abs(ny/L)*0.3+0.3))
        col=(int(18+10*sh),int(30+150*sh),int(35+130*sh))
        x0=max(0,int(min(p[0] for p in s))); x1=min(W-1,int(max(p[0] for p in s))+1)
        y0=max(0,int(min(p[1] for p in s))); y1=min(H-1,int(max(p[1] for p in s))+1)
        d=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
        if abs(d)<1e-9: continue
        for y in range(y0,y1+1):
            for x in range(x0,x1+1):
                w0=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/d
                w1=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/d
                w2=1-w0-w1
                if w0<-.001 or w1<-.001 or w2<-.001: continue
                z=w0*a[2]+w1*b[2]+w2*c[2]
                if z<zb[y][x]: zb[y][x]=z; px[y][x]=col
    raw=b"".join(b"\x00"+bytes(v for p in row for v in p) for row in px)
    def ch(t,d):
        c=t+d; return struct.pack(">I",len(d))+c+struct.pack(">I",zlib.crc32(c)&0xffffffff)
    open(path,"wb").write(b"\x89PNG\r\n\x1a\n"+ch(b"IHDR",struct.pack(">IIBBBBB",W,H,8,2,0,0,0))+ch(b"IDAT",zlib.compress(raw,6))+ch(b"IEND",b""))
    print("wrote",path)


render(load("lens-gear-train.stl"),"preview-print.png",0,90)
render(load("lens-gear-assembled.stl"),"preview-assembled.png",-38,24)
