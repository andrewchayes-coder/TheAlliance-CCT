import { it, expect, vi } from 'vitest';
import { attentionReasons } from '../volunteer-attention';
import { sortRoster, filterRoster, rosterSummary, type RosterPerson, type RosterFilters } from '../admin-roster';
import { retiredVolunteerStatuses } from '@workspace/shared/legacy-compatibility';
import { appConfig } from '@workspace/shared/appConfig';
import { testProfileFields } from '@workspace/shared/testAccounts';
vi.hoisted(()=>{
  process.env.NODE_ENV='development';
  process.env.APP_ORIGIN ||= 'https://roster-fixture.example.invalid';
});

const person=(id:string,overrides:Record<string,unknown>={}):RosterPerson => ({
  user:{id,firstName:'Test',lastName:id,email:`${id}@example.invalid`,phone:'5555550100',isTestAccount:false,lastLoginAt:new Date('2026-03-01')},
  profile:{...testProfileFields,status:'onboarding',county:'Placer',createdAt:new Date('2026-03-01T08:00:00Z'),onboardingCompletedAt:new Date(),
    certificationExpiresAt:null,backgroundCheckStatus:'not_started',backgroundCheckSubmittedAt:null,startDate:'2026-01-01',...overrides},
  shiftCount:0,shifts:[],attention:[],
} as unknown as RosterPerson);

it('immediately flags review and retains Pacific calendar onboarding escalations',()=>{
  const fresh=person('fresh',{createdAt:new Date('2026-03-09T07:00:00Z'),dateOfBirth:null});
  expect(attentionReasons(fresh.profile,0,'2026-03-16',fresh.user)).toEqual(['awaiting_review']);
  const old=person('old',{createdAt:new Date('2026-03-09T06:59:00Z'),dateOfBirth:null});
  expect(attentionReasons(old.profile,0,'2026-03-16',old.user)).toEqual(['awaiting_review','onboarding_incomplete']);
  const complete=person('complete',{createdAt:new Date('2026-02-13T08:00:00Z')});
  expect(attentionReasons(complete.profile,0,'2026-03-16',complete.user)).toEqual(['awaiting_review','onboarding_overdue']);
  expect(attentionReasons({...complete.profile,dateOfBirth:null},0,'2026-03-16',complete.user)).toEqual(['awaiting_review','onboarding_incomplete','onboarding_overdue']);
  expect(attentionReasons({...complete.profile,onboardingSince:new Date('2026-03-15T07:00:00Z')},0,'2026-03-16',complete.user)).toEqual(['awaiting_review']);
  expect(attentionReasons({...complete.profile,status:'active'},0,'2026-03-16',complete.user)).toEqual(['no_shift']);
  expect(attentionReasons({...complete.profile,status:'inactive',onboardingCompletedAt:null},0,'2026-03-16',complete.user)).toEqual([]);
});

it('normalizes existing legacy onboarding, deduplicates counts and preserves test visibility and compliance flags',()=>{
  const previous={...appConfig};
  try {
    Object.assign(appConfig,{trackCertificationInApp:true,trackBackgroundCheckInApp:true});
    const rows=['onboarding',...retiredVolunteerStatuses].map((status,i)=>{
      const row=person(String(i),{status,dateOfBirth:null,createdAt:new Date('2026-01-01T08:00:00Z'),
        certificationExpiresAt:'2026-03-20',backgroundCheckStatus:'pending',backgroundCheckSubmittedAt:'2026-02-01'});
      row.attention=attentionReasons(row.profile,0,'2026-03-16',row.user);
      expect(row.attention).toEqual(['certification_expiring','background_pending','awaiting_review','onboarding_incomplete','onboarding_overdue']);
      return row;
    });
    const synthetic=person('test');synthetic.user.isTestAccount=true;synthetic.attention=['awaiting_review'];
    const all=[...rows,synthetic];
    expect(rosterSummary(all).needsAttention).toBe(rows.length);
    expect(filterRoster(all,{needsAttention:'awaiting_review'})).toEqual(rows);
    expect(filterRoster(all,{needsAttention:'any'})).toEqual(rows);
    expect(filterRoster(all,{needsAttention:'awaiting_review',showTestAccounts:'true'})).toHaveLength(all.length);
    Object.assign(appConfig,{trackCertificationInApp:false,trackBackgroundCheckInApp:false});
    expect(attentionReasons(rows[0]!.profile,0,'2026-03-16',rows[0]!.user)).toEqual(['awaiting_review','onboarding_incomplete','onboarding_overdue']);
  } finally {Object.assign(appConfig,previous);}
});

it('sorts every column globally in either direction, with deterministic ties and nulls last',()=>{
  const keys:NonNullable<RosterFilters['sortBy']>[]=['name','status','phone','email','city','startDate','shiftCount','lastLoginAt','dateOfBirth','address','zip','emergencyContact','county'];
  const a=person('a'),b=person('b',{city:'Zion'}),empty=person('c',{city:null});
  b.shiftCount=2;
  for(const sortBy of keys) for(const sortDirection of ['asc','desc'] as const) {
    expect(sortRoster([b,a],{sortBy,sortDirection})).toHaveLength(2);
  }
  expect(sortRoster([b,empty,a],{sortBy:'city',sortDirection:'desc'}).map(p=>p.user.id)).toEqual(['b','a','c']);
  expect(sortRoster([b,a],{sortBy:'shiftCount'}).map(p=>p.user.id)).toEqual(['a','b']);
  expect(sortRoster([b,a],{sortBy:'email',sortDirection:'desc'}).map(p=>p.user.id)).toEqual(['b','a']);
});

it('filters city, county, standing shifts and actual required fields even with legacy completion timestamps',()=>{
  const a=person('a'),b=person('b',{city:'Roseville',county:'Nevada',dateOfBirth:null});
  b.shiftCount=1;
  expect(filterRoster([a,b],{city:'Auburn',county:'Placer',shiftPresence:'no_shift',profileIncomplete:'false'}).map(p=>p.user.id)).toEqual(['a']);
  expect(filterRoster([a,b],{shiftPresence:'has_shift',profileIncomplete:'true'}).map(p=>p.user.id)).toEqual(['b']);
});
