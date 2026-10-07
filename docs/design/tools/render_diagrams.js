const fs=require('node:fs');
const {instance}=require('@viz-js/viz');
const sharp=require('sharp');
const root=require('node:path').resolve(__dirname,'../diagrams');
const specs=JSON.parse(fs.readFileSync(root+'/diagram_specs.json','utf8'));
const q=s=>JSON.stringify(s);
function wrap(s,max=24){const words=s.split(' '),lines=[];let line='';for(const word of words){if(line&&(line.length+word.length+1)>max){lines.push(line);line=word;}else line+=(line?' ':'')+word;}if(line)lines.push(line);return lines.join('\n');}
const colors={process:['#ffffff','#94a8c2'],decision:['#edf3ff','#7399d7'],external:['#f0f3f6','#8192a5'],success:['#e9f6ee','#559b75'],wait:['#fff4df','#bd9651'],failure:['#fcebed','#bd6876'],security:['#f2edfb','#9478bb']};
(async()=>{
 const viz=await instance(),results=[];
 for(const g of specs){
  const lines=['digraph '+g.id+' {','graph [rankdir=TB, bgcolor="#f8fafc", pad="0.30", nodesep="0.32", ranksep="0.52", splines=polyline, fontname="DejaVu Sans", fontsize=17, labelloc=t, label='+q(g.id+'  |  '+({'D01':'System architecture','D02':'Task lifecycle','D03':'Reference and data verification','D04':'Admission and egress','D05':'User interaction and reconnection','D06':'Stop and result race','D07':'Crash recovery','D08':'Evidence and public verification','D09':'Publication and chain observation','D10':'Data ingestion and freshness','D11':'Build and delivery gates','D12':'Market validation'})[g.id])+'];',
   'node [shape=box, style="rounded,filled", margin="0.15,0.12", fontname="DejaVu Sans", fontsize=12.5, fontcolor="#17304b", penwidth=1.15, width=1.95];',
   'edge [color="#687e99", arrowsize=0.7, penwidth=1.05, fontname="DejaVu Sans", fontsize=10, fontcolor="#485f7a"];'];
  for(const n of g.nodes){const [fill,border]=colors[n.kind];lines.push(n.id+' [label='+q(wrap(n.label))+', fillcolor='+q(fill)+', color='+q(border)+(n.kind==='decision'?', shape=diamond, style=filled, margin="0.09,0.05", width=2.1':'')+'];');}
  for(let i=0;i<g.groups.length;i++){const group=g.groups[i];lines.push('subgraph cluster_'+i+' { label='+q(group.name)+'; color="#d5dfeb"; style="rounded,dashed"; fontsize=11; fontcolor="#526780"; '+group.nodes.join('; ')+'; }');}
  for(const e of g.edges){const attrs=[];if(e.label)attrs.push('label='+q(wrap(e.label,24)));if(g.id==='D01'&&[['agent','control'],['verify','db']].some(([a,b])=>e.from===a&&e.to===b))attrs.push('constraint=false');lines.push(e.from+' -> '+e.to+(attrs.length?' ['+attrs.join(', ')+']':'')+';');}
  lines.push('}');const dot=lines.join('\n');fs.writeFileSync(root+'/'+g.id+'.dot',dot);
  const result=viz.render(dot,{format:'svg'});
  if(result.status!=='success')throw new Error(g.id+JSON.stringify(result.errors));
  const svg=result.output;fs.writeFileSync(root+'/'+g.id+'.svg',svg);
  const layout=JSON.parse(viz.renderString(dot,{format:'json'}));
  const nodeIds=new Set(g.nodes.map(n=>n.id));const positioned=(layout.objects||[]).filter(o=>nodeIds.has(o.name));
  const ranks={};for(const n of positioned){const [,y]=n.pos.split(',').map(Number);const k=y.toFixed(1);(ranks[k]??=[]).push(n.name);}
  const maxRow=Math.max(...Object.values(ranks).map(a=>a.length));
  if(maxRow>5)throw new Error(g.id+' has '+maxRow+' nodes aligned horizontally');
  const metadata=await sharp(Buffer.from(svg)).metadata();
  await sharp(Buffer.from(svg),{density:160}).resize({width:Math.min(1800,Math.ceil(metadata.width*1.7)),withoutEnlargement:false}).png().toFile(root+'/'+g.id+'.png');
  results.push({id:g.id,nodes:g.nodes.length,edges:g.edges.length,maxHorizontalNodes:maxRow,svgViewBox:svg.match(/viewBox="([^"]+)"/)?.[1],warnings:result.errors||[],status:'RENDERED'});
 }
 fs.writeFileSync(root+'/../checks/diagram_render_checks.json',JSON.stringify(results,null,2)+'\n');
 console.log(JSON.stringify(results.map(({id,maxHorizontalNodes,status})=>({id,maxHorizontalNodes,status})),null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
