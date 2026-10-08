import { Link } from 'wouter';
import { PublicLayout, Button } from '@/components/brand-system';
import { AuthHeading } from '@/auth/auth-ui';
export default function NotFound() {
  return <PublicLayout>
    <AuthHeading label="Let’s find your way back" title="That page isn’t available">
      The link may have changed. Return to the portal to find your shifts, messages, and resources.
    </AuthHeading>
    <Button asChild><Link href="/">Return to the portal</Link></Button>
  </PublicLayout>;
}
