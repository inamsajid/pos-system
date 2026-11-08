import type { LucideIcon } from 'lucide-react'
import { EmptyState } from '../../components/feedback/EmptyState'
import { PageHeader } from '../../components/common/PageHeader'
import { Button } from '../../components/ui/Button'
export function PlaceholderPage({title,description,icon:Icon}:{title:string;description:string;icon:LucideIcon}){return <><PageHeader title={title} description={description} action={<Button disabled>Coming soon</Button>}/><EmptyState icon={Icon} title={`${title} workspace is ready`} description={`This is the foundation for ${title.toLowerCase()}. Connect the future API and add workflows here when you are ready.`}/></>}
