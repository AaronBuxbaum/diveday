# Captain and crew

Sal, on a phone at the dock, wet hands, sometimes no signal. Everything here is safety-critical:
boring code, failure-path tests, and a `dive-domain-expert` review on any change. See
[personas.md](../personas.md#10-sal--the-captain-with-wet-hands).

### ROLL-01 Roll call keeps blocked divers visible

As Sal, the live manifest never hides a blocked diver, and I can record that someone did not board.

**Done when**
- Blocked divers stay on the manifest.
- A not-boarded result is recorded explicitly, never implied.
- Resolving a blocker from the manifest lands on that diver.

### ROLL-02 Roll call works with no signal

As Sal, I save the manifest before leaving the dock, count divers offline, and it reconciles when
the phone is back online.

**Done when**
- The full checkpoint manifest is saved, reloaded offline, and reconciled on reconnect.
- The saved copy opens even after a failed reload.
- The offline page never reaches beyond the manifest, and the live response is never cached.

### ROLL-03 Offline never outranks the live record

As the shop, an old saved copy can never override what the shop knows now.

**Done when**
- An expired saved copy refuses new writes.
- Sync never replaces newer live history; a mark that conflicts with it keeps the count open until crew reconcile it.

### ROLL-04 A checkpoint stays open until everyone is counted

As Sal, the checkpoint does not close while a diver or a crew member is still uncounted.

**Done when**
- A checkpoint with every diver counted stays open until the crew are called too.

### ROLL-05 A diver aboard cannot be removed after departure

As the shop, a diver marked aboard a boat that has left cannot be quietly removed.

**Done when**
- Remove says why it is refused and changes nothing.

### ROLL-06 The captain adds a rider at the dock

As Sal, a last-minute rider counts at once, and only once.

**Done when**
- The rider appears in the count immediately and a repeat tap does not add them twice.

### ROLL-07 The pre-departure checklist survives a bad signal

As Sal, a checklist tap made offline queues, syncs when the signal returns, and two taps undo it.

**Done when**
- An offline tap queues and then syncs to the live manifest, and two taps undo it.
- A late sync never overrides a newer live mark.

### ROLL-08 The crew can open a medical alert, and it is logged

As the shop, anyone who reads a diver's medical alert leaves a mark on that diver's trail.

**Done when**
- A departure's crew can open the alert and the read is logged.
- An owner printing the packet with the alerts is logged.
- An instructor off the crew can open one in an emergency, and it is logged.

### ROLL-09 A lapsed safety kit is named before the boat sails

As Sal, the departure says which safety item is missing or about to expire.

**Done when**
- Missing oxygen, expired flares and coming-due AED pads are each named.
- A boat's papers and the kit aboard it reach the departure that sails on it.

### ROLL-10 Incidents are written down and kept

As Sal, I can write, file and amend an incident report, and the shop finds it later.

**Done when**
- A report is written, filed, amended, and found on the Safety tab.

### ROLL-11 The counter works offline too

As Chloe, a check-in made offline queues and lands on the live counter when signal returns.

**Done when**
- An offline counter check-in queues, syncs, and appears on the live counter.
- A failed reload of the counter lands on the saved copy.
