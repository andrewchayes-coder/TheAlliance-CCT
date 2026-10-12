import { appConfig } from '@workspace/shared/appConfig';
import { PageHeader } from '@/components/page-header';
import { Link } from 'wouter';
import { PublicLayout, StyleGuideLink, Button } from '@/components/brand-system';

export default function Home() {
  return (
    <PublicLayout>
      <PageHeader eyebrow={appConfig.programName} title={appConfig.appName} titleTestId="text-portal-title" className="[&+*]:!mt-0" />
      <p className="mt-5">A welcoming place for our Resource Coordinators in {appConfig.defaultCounty} County.</p>
      <p className="mt-4">Choose your weekly shift, stay connected with the team, and find guides to help neighbors connect with support.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button asChild><Link href="/signin" data-testid="link-signin">Sign in</Link></Button>
        <Button asChild variant="secondary"><Link href="/signup" data-testid="link-signup">Create an account</Link></Button>
      </div>
      {import.meta.env.DEV && <div className="mt-6 border-t border-gray pt-5"><StyleGuideLink /></div>}
    </PublicLayout>
  );
}
