/** CCT's confirmed overlapping weekly grid; importing this has no side effects. */
export const standardGrid = Array.from({length:5},(_,day)=>Array.from({length:8},(_,hour)=>({
  dayOfWeek:day+1,startTime:`${String(hour+9).padStart(2,'0')}:00`,
  endTime:`${String(hour+11).padStart(2,'0')}:00`,capacity:2,label:null,isActive:true,
}))).flat();
