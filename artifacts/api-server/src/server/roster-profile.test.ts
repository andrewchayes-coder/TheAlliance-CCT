import { it, expect, vi } from 'vitest';
import { attentionReasons } from '../volunteer-attention';
import { sortRoster, filterRoster, type RosterPerson, type RosterFilters } from '../admin-roster';
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

it('uses Pacific calendar boundaries and only the requested onboarding age rules',()=>{
  const fresh=person('fresh',{createdAt:new Date('2026-03-09T07:00:00Z'),dateOfBirth:null});
  expect(attentionReasons(fresh.profile,0,'2026-03-16',fresh.user)).toEqual([]);
  const old=person('old',{createdAt:new Date('2026-03-09T06:59:00Z'),dateOfBirth:null});
  expect(attentionReasons(old.profile,0,'2026-03-16',old.user)).toEqual(['onboarding_incomplete']);
  const complete=person('complete',{createdAt:new Date('2026-02-13T08:00:00Z')});
  expect(attentionReasons(complete.profile,0,'2026-03-16',complete.user)).toEqual(['onboarding_overdue']);
  expect(attentionReasons({...complete.profile,dateOfBirth:null},0,'2026-03-16',complete.user)).toEqual(['onboarding_incomplete','onboarding_overdue']);
  expect(attentionReasons({...complete.profile,onboardingSince:new Date('2026-03-15T07:00:00Z')},0,'2026-03-16',complete.user)).toEqual([]);
  expect(attentionReasons({...complete.profile,status:'active'},0,'2026-03-16',complete.user)).toEqual(['no_shift']);
  expect(attentionReasons({...complete.profile,status:'inactive',onboardingCompletedAt:null},0,'2026-03-16',complete.user)).toEqual([]);
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
