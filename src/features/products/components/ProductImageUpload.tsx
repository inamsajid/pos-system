import { ImagePlus, Trash2, Upload } from 'lucide-react'
import { ProductImage } from './ProductImage'

export function ProductImageUpload({value,onChange}:{value?:string;onChange:(url?:string)=>void}){
  const handleFile=(file?:File)=>{if(!file)return;if(!file.type.startsWith('image/'))return;onChange(URL.createObjectURL(file))}
  return <div><span className="block text-xs font-semibold text-slate-700">Product image <span className="font-normal text-slate-400">(optional)</span></span><div className="mt-2 flex flex-wrap items-center gap-4">
    <ProductImage name="Product preview" imageUrl={value} className="h-20 w-20 rounded-2xl border border-slate-200"/>
    <div><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Upload size={14}/>{value?'Change image':'Choose image'}<input type="file" accept="image/*" className="sr-only" onChange={(event)=>handleFile(event.target.files?.[0])}/></label><p className="mt-2 text-[11px] text-slate-400">Image preview stays in this browser session. Nothing is uploaded.</p>{value&&<button type="button" onClick={()=>onChange(undefined)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-rose-600"><Trash2 size={13}/>Remove image</button>}</div>
  </div><div className="sr-only"><ImagePlus size={1}/></div></div>
}
