import { Image as ImageIcon } from 'lucide-react'
import { getProductInitials } from '../utils/productUtils'

export function ProductImage({name,imageUrl,className=''}:{name:string;imageUrl?:string;className?:string}){
  return <div className={`grid shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-100 text-slate-500 ${className}`}>
    {imageUrl ? <img src={imageUrl} alt={name} className="h-full w-full object-cover"/> : <span aria-label={`${getProductInitials(name)} product image placeholder`} className="flex h-full w-full flex-col items-center justify-center gap-1 text-[10px] font-semibold"><ImageIcon size={16}/>{getProductInitials(name)}</span>}
  </div>
}
