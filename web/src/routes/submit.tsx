import { PagePlaceholder } from './placeholder';

export default function SubmitPage() {
  return (
    <PagePlaceholder
      title="Submit an event"
      description="Paste a webhook event plus its delivery attempt(s) to investigate."
      lands="A form matching ManualSubmissionSchema with inline Zod validation; on submit it POSTs /events and navigates to the new event's detail page."
    />
  );
}
