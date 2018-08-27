const extend = require('deep-extend')

module.exports = function suggested (self) {
  return {
    // go through contacts and find most followed contact currently not being followed
    contacts: async () => {
      let suggestedContacts = new Map()

      const considerContact = async (contact) => {
        const haveContact = await self.contacts.has(self.address, contact._id)
        if (!haveContact) {
          const suggestedContact = suggestedContacts.get(contact._id)
          const count = suggestedContact ? suggestedContact.count++ : 0
          suggestedContacts.set(contact._id, extend(contact, { count }))
        }
      }

      const contacts = await self.contacts.list(self.address)
      for (const contact of contacts) {
        const contactsOfContact = await self.contacts.list(contact.content.address)
        contactsOfContact.forEach(considerContact)
      }

      suggestedContacts = Array.from(suggestedContacts.values())
      const sortedContacts = suggestedContacts.sort((a, b) => b.count - a.count)

      return sortedContacts
    }
  }
}
