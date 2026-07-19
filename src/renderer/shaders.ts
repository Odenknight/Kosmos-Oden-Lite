/**
 * Kosmos renderer — instanced body/glow shader materials.
 * Faithful port of the v0.5.0 shaders: ACES-tonemapped celestial bodies with
 * per-instance color/seed/visibility/highlight attributes, a cheaper LITE
 * variant for low-power devices, and the additive-blend glow billboards.
 */

export function bodyMaterial(THREE: any, o: any): any {
  o = Object.assign({ SPIN: 0, TUMBLE: 0, STAR: 0, ATMO: 0, PLANET: 0, SURF: 0, ROCK: 0, AMBIENT: 0.16, DIFF: 0.95, SPIN_SPEED: 0.12, EXPOSURE: 1.05 }, o);
  const ACES = `vec3 aces(vec3 x){return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);}
vec3 toSRGB(vec3 c){return pow(max(c,0.0),vec3(0.4545));}`;
  const ROT = `mat3 rotAxis(vec3 a,float an){float c=cos(an),s=sin(an),t=1.0-c;
 return mat3(t*a.x*a.x+c,t*a.x*a.y-s*a.z,t*a.x*a.z+s*a.y,
             t*a.x*a.y+s*a.z,t*a.y*a.y+c,t*a.y*a.z-s*a.x,
             t*a.x*a.z-s*a.y,t*a.y*a.z+s*a.x,t*a.z*a.z+c);}
mat3 rotY(float a){float c=cos(a),s=sin(a);return mat3(c,0.,-s,0.,1.,0.,s,0.,c);}`;
  const D = `${o.STAR ? "#define STAR\n" : ""}${o.ATMO ? "#define ATMO\n" : ""}${o.SPIN ? "#define SPIN\n" : ""}${o.TUMBLE ? "#define TUMBLE\n" : ""}${o.PLANET ? "#define PLANET\n" : ""}${o.SURF ? "#define SURF\n" : ""}${o.ROCK ? "#define ROCK\n" : ""}`;
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uGlowAll: { value: 0 }, uLightDir: { value: new THREE.Vector3(0.5, 0.62, 0.4).normalize() }, uCamPos: { value: new THREE.Vector3() } },
    vertexShader: `${D}${ROT}
      attribute vec3 aColor; attribute float aSeed; attribute float aVisible;
      attribute float aHi; attribute float aLive; attribute float aEmerge; attribute float aBand;
      uniform float uTime;
      varying vec3 vColor; varying vec3 vWN; varying vec3 vWP; varying vec3 vObjNRM;
      varying float vHi; varying float vLive; varying float vEmerge; varying float vSeed; varying float vBand;
      #ifdef ROCK
      float hrock(vec3 q){ return fract(sin(dot(q,vec3(17.1,113.5,71.7)))*43758.5453); }
      #endif
      void main(){
        vColor=aColor; vHi=aHi; vLive=aLive; vEmerge=aEmerge; vSeed=aSeed; vBand=aBand;
        vec3 p=position; vec3 nrm=normal;
        #ifdef SPIN
          float sa=uTime*${o.SPIN_SPEED.toFixed(3)}*(0.5+aSeed); mat3 RS=rotY(sa); p=RS*p; nrm=RS*nrm;
        #endif
        #ifdef TUMBLE
          float ta=uTime*(0.18+aSeed*0.5);
          vec3 ax=normalize(vec3(aSeed-0.5,fract(aSeed*7.3)-0.5,fract(aSeed*3.1)-0.5)+0.001);
          mat3 RT=rotAxis(ax,ta); p=RT*p; nrm=RT*nrm;
        #endif
        #ifdef ROCK
          p*=0.76+0.24*hrock(position+aSeed*19.0);   // carve-only per-vertex displacement: irregular rock, never exceeds the collision radius
        #endif
        float boost=1.0+aLive*(0.16+0.12*sin(uTime*4.0+aSeed*6.28))+aEmerge*0.6;
        p*=boost; vObjNRM=normalize(nrm);
        mat4 toWorld=modelMatrix*instanceMatrix;
        vec4 wp=toWorld*vec4(p,1.0); vWP=wp.xyz;
        vWN=normalize(mat3(toWorld)*nrm);
        gl_Position=projectionMatrix*viewMatrix*wp;
        if(aVisible<0.5) gl_Position=vec4(2.0,2.0,2.0,1.0);
      }`,
    fragmentShader: `${D}${ACES}
      uniform float uTime; uniform vec3 uLightDir; uniform vec3 uCamPos; uniform float uGlowAll;
      varying vec3 vColor; varying vec3 vWN; varying vec3 vWP; varying vec3 vObjNRM;
      varying float vHi; varying float vLive; varying float vEmerge; varying float vSeed; varying float vBand;
      float h31(vec3 p){ return fract(sin(dot(p,vec3(17.1,113.5,71.7)))*43758.5453); }
      float vnoise(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        float a=mix(mix(h31(i),h31(i+vec3(1,0,0)),f.x), mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x), f.y);
        float b=mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x), mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x), f.y);
        return mix(a,b,f.z); }
      float fbm(vec3 p){ float s=0.0,a=0.5; for(int k=0;k<3;k++){ s+=a*vnoise(p); p*=2.03; a*=0.5; } return s; }
      void main(){
        vec3 N=normalize(vWN); vec3 V=normalize(uCamPos-vWP); float NV=clamp(dot(N,V),0.0,1.0);
        vec3 L=normalize(uLightDir); vec3 col;
        #ifdef STAR
          float ld=pow(NV,0.55);
          float fl=0.85+0.15*sin(uTime*3.0+vSeed*40.0)+0.07*sin(uTime*7.3+vSeed*13.0);
          col=vColor*(1.5*fl)*mix(0.6,1.28,ld)+vColor*0.5;
          col=mix(col, vec3(1.0,0.96,0.88), pow(1.0-NV,2.2)*0.55);
        #else
          float diff=max(dot(N,L),0.0); float wrap=diff*0.9+0.1;
          vec3 base=vColor;
          #ifdef ROCK
            base*=0.82+0.36*fract(vSeed*5.7);                        // per-rock albedo variation
            base=mix(base,base*vec3(1.06,0.98,0.90),fract(vSeed*3.3));   // warm/cool mineral tint
          #endif
          #ifdef SURF
            float m=fbm(vObjNRM*3.2+vSeed*7.0);
            base*=mix(0.78,1.18,m);
            base+=vColor*0.20*smoothstep(0.58,0.9,m);
            #ifdef PLANET
              // vBand carries the NASA exoplanet class: 0 terrestrial, 1 gas giant, 2 neptunian, 3 super-earth
              if(vBand<0.5){                                                               // terrestrial: land/sea + polar ice caps
                base=mix(base,base*vec3(0.74,0.87,1.05),smoothstep(0.30,0.62,m)*0.35);
                float cap=smoothstep(0.74,0.92,abs(vObjNRM.y)+(m-0.5)*0.18);
                base=mix(base,vec3(0.93,0.97,1.0),cap*0.6);
              } else if(vBand<1.5){                                                        // gas giant: soften surface relief (bands added below)
                base=mix(base,vColor,0.45);
              } else if(vBand<2.5){                                                        // neptunian ice giant: smooth, cold, high-altitude haze
                base=mix(base,vColor,0.55);
                base=mix(base,base*vec3(0.82,0.94,1.22),0.5);
                base+=vec3(0.02,0.05,0.10)*smoothstep(0.6,0.95,m);
              } else {                                                                     // super-earth: amplified relief, continental contrast
                base*=mix(0.68,1.30,m);
                base=mix(base,base*vec3(0.80,0.92,1.06),smoothstep(0.42,0.72,m)*0.45);
              }
            #else
              base*=1.0-0.28*smoothstep(0.60,0.80,m);                                      // lunar maria patches
              base+=vec3(0.05)*smoothstep(0.84,0.96,m);                                    // bright ejecta flecks
            #endif
          #endif
          col=base*(${o.AMBIENT.toFixed(3)}+wrap*${o.DIFF.toFixed(3)});
          vec3 H=normalize(L+V); col+=vec3(1.0)*pow(max(dot(N,H),0.0),30.0)*diff*0.20;
          #ifdef ATMO
            float rim=pow(1.0-NV,3.0); col+=vColor*rim*0.55*(0.35+0.65*diff);
          #endif
          #ifdef PLANET
            float lat=clamp(vObjNRM.y,-1.0,1.0);
            if(vBand>0.5&&vBand<1.5){                                                      // gas giant: warm Jupiter/Saturn banding
              float bands=0.5+0.5*sin(lat*11.0+vSeed*5.0);
              col=mix(col, col*vec3(1.18,1.06,0.82)+vec3(0.015), bands*0.5);
            } else if(vBand>1.5&&vBand<2.5){                                               // neptunian: faint cool bands
              float nbands=0.5+0.5*sin(lat*7.0+vSeed*4.0);
              col=mix(col, col*vec3(0.88,0.98,1.16), nbands*0.30);
            }
          #endif
        #endif
        col+=vColor*vHi*1.7; col+=vColor*pow(1.0-NV,2.0)*vHi*1.5; col=mix(col,vec3(1.0),vHi*0.30);
        float lp=0.5+0.5*sin(uTime*4.0+vSeed*6.28);
        col+=vColor*vLive*(0.55+0.85*lp);
        col+=vec3(1.0)*vEmerge*(0.55*lp+0.2);
        col+=vColor*uGlowAll*0.85;
        gl_FragColor=vec4(toSRGB(aces(col*${o.EXPOSURE.toFixed(3)})),1.0);
      }`,
  });
}

/** Low-power variant: same vertex motion, cheaper fragment path. */
export function bodyMaterialLite(THREE: any, o: any): any {
  o = Object.assign({ SPIN: 0, TUMBLE: 0, STAR: 0, ATMO: 0, ROCK: 0, AMBIENT: 0.18, DIFF: 0.95, SPIN_SPEED: 0.12, EXPOSURE: 1.0 }, o);
  const ROT = `mat3 rotY(float a){float c=cos(a),s=sin(a);return mat3(c,0.,-s,0.,1.,0.,s,0.,c);}`;
  const D = `${o.STAR ? "#define STAR\n" : ""}${o.SPIN ? "#define SPIN\n" : ""}${o.TUMBLE ? "#define TUMBLE\n" : ""}${o.ROCK ? "#define ROCK\n" : ""}`;
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uGlowAll: { value: 0 }, uLightDir: { value: new THREE.Vector3(0.5, 0.62, 0.4).normalize() }, uCamPos: { value: new THREE.Vector3() } },
    vertexShader: `${D}${ROT}
      attribute vec3 aColor; attribute float aSeed; attribute float aVisible;
      attribute float aHi; attribute float aLive; attribute float aEmerge;
      uniform float uTime;
      varying vec3 vColor; varying vec3 vWN; varying vec3 vWP; varying float vHi; varying float vLive; varying float vEmerge; varying float vSeed;
      #ifdef ROCK
      float hrock(vec3 q){ return fract(sin(dot(q,vec3(17.1,113.5,71.7)))*43758.5453); }
      #endif
      void main(){
        vColor=aColor; vHi=aHi; vLive=aLive; vEmerge=aEmerge; vSeed=aSeed;
        vec3 p=position; vec3 nrm=normal;
        #ifdef SPIN
          float sa=uTime*${o.SPIN_SPEED.toFixed(3)}*(0.5+aSeed); mat3 RS=rotY(sa); p=RS*p; nrm=RS*nrm;
        #endif
        #ifdef TUMBLE
          float ta=uTime*(0.18+aSeed*0.5); mat3 RT=rotY(ta); p=RT*p; nrm=RT*nrm;
        #endif
        #ifdef ROCK
          p*=0.76+0.24*hrock(position+aSeed*19.0);   // carve-only rock displacement (vertex-side, mobile-safe)
        #endif
        float boost=1.0+aLive*0.18+aEmerge*0.5; p*=boost;
        mat4 toWorld=modelMatrix*instanceMatrix; vec4 wp=toWorld*vec4(p,1.0);
        vWP=wp.xyz; vWN=normalize(mat3(toWorld)*nrm);
        gl_Position=projectionMatrix*viewMatrix*wp;
        if(aVisible<0.5) gl_Position=vec4(2.0,2.0,2.0,1.0);
      }`,
    fragmentShader: `${D}
      uniform float uTime; uniform vec3 uLightDir; uniform vec3 uCamPos; uniform float uGlowAll;
      varying vec3 vColor; varying vec3 vWN; varying vec3 vWP; varying float vHi; varying float vLive; varying float vEmerge; varying float vSeed;
      vec3 toSRGB(vec3 c){return pow(max(c,0.0),vec3(0.4545));}
      void main(){
        vec3 N=normalize(vWN); vec3 V=normalize(uCamPos-vWP); float NV=clamp(dot(N,V),0.0,1.0); vec3 col;
        #ifdef STAR
          float ld=pow(NV,0.55); float fl=0.9+0.1*sin(uTime*3.0+vSeed*40.0);
          col=vColor*(1.4*fl)*mix(0.62,1.25,ld)+vColor*0.45;
          col=mix(col, vec3(1.0,0.96,0.88), pow(1.0-NV,2.2)*0.5);
        #else
          float diff=max(dot(N,normalize(uLightDir)),0.0);
          vec3 vc=vColor;
          #ifdef ROCK
            vc*=0.82+0.36*fract(vSeed*5.7);                          // per-rock albedo variation
          #endif
          col=vc*(${o.AMBIENT.toFixed(3)}+(diff*0.9+0.1)*${o.DIFF.toFixed(3)});
          col+=vColor*pow(1.0-NV,3.0)*0.35*(0.4+0.6*diff);
        #endif
        col+=vColor*vHi*1.5; col+=vColor*pow(1.0-NV,2.0)*vHi*1.3; col=mix(col,vec3(1.0),vHi*0.28);
        float lp=0.5+0.5*sin(uTime*4.0+vSeed*6.28);
        col+=vColor*vLive*(0.5+0.7*lp)+vec3(1.0)*vEmerge*0.5;
        col+=vColor*uGlowAll*0.7;
        gl_FragColor=vec4(toSRGB(col*${o.EXPOSURE.toFixed(3)}),1.0);
      }`,
  });
}

export function glowMaterial(THREE: any): any {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute vec3 aColor; attribute float aSize; attribute float aVisible; attribute float aLive; attribute float aSeed;
      uniform float uTime; varying vec3 vColor; varying vec2 vUv; varying float vLive;
      void main(){ vColor=aColor; vUv=uv-0.5; vLive=aLive;
        float pulse=1.0+aLive*0.35*sin(uTime*3.5+aSeed*6.28);
        vec4 c=modelViewMatrix*instanceMatrix*vec4(0.0,0.0,0.0,1.0);
        c.xy+=position.xy*aSize*pulse; gl_Position=projectionMatrix*c;
        if(aVisible<0.5) gl_Position=vec4(2.0,2.0,2.0,1.0); }`,
    fragmentShader: `varying vec3 vColor; varying vec2 vUv; varying float vLive;
      void main(){ float d=length(vUv)*2.0; float a=pow(smoothstep(1.0,0.0,d),2.2);
        float ring=vLive*smoothstep(0.06,0.0,abs(d-0.82))*0.85;
        gl_FragColor=vec4(vColor*(a*1.4+ring),a*0.9+ring); }`,
  });
}
