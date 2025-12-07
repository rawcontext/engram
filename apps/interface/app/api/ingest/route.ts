import { NextResponse } from 'next/server';
import { RawStreamEventSchema } from '@the-soul/events';
import { validate } from '../../../lib/validate';

export const POST = async (req: Request) => {
    return validate(RawStreamEventSchema)(req, async (data) => {
        console.log('Ingesting event:', data.event_id);
        // TODO: Push to Redpanda via Ingestion Service or direct Kafka client
        return NextResponse.json({ status: 'accepted', event_id: data.event_id }, { status: 202 });
    });
};
